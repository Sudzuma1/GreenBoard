const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Подключение к базе данных
const db = new sqlite3.Database('./ads.db');

// Создание таблицы, если её нет
db.run(`CREATE TABLE IF NOT EXISTS ads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    photo TEXT,
    description TEXT,
    isPremium BOOLEAN,
    userId TEXT
)`);

// Хранилище временных блокировок (анти-спам)
const adCooldown = new Map();

// Middleware для статических файлов
app.use(express.static(path.join(__dirname, 'public')));

// WebSocket соединение
io.on('connection', (socket) => {
    console.log('Новый пользователь подключен:', socket.id);

    // Отправляем текущие объявления новому пользователю
    db.all(`SELECT * FROM ads`, (err, rows) => {
        if (err) return console.error(err);
        socket.emit('initial-ads', rows);
    });

    // Обработка нового объявления
    socket.on('new-ad', (ad) => {
        const now = Date.now();
        const lastPostTime = adCooldown.get(socket.id);

        // Проверка частоты публикации (1 минута)
        if (lastPostTime && now - lastPostTime < 60000) {
            socket.emit('error', 'Вы слишком часто размещаете объявления!');
            return;
        }

        // Проверка заполнения полей
        if (!ad.title || !ad.photo || !ad.description) {
            socket.emit('error', 'Некорректные данные!');
            return;
        }

        // Проверка лимита объявлений
        db.get(`SELECT COUNT(*) as count FROM ads WHERE userId = ? AND isPremium = ?`, [socket.id, ad.isPremium], (err, row) => {
            if (err) return console.error(err);

            if (row.count > 0) {
                socket.emit('error', 'Вы уже разместили объявление этого типа!');
            } else {
                // Добавление объявления в базу
                db.run(
                    `INSERT INTO ads (title, photo, description, isPremium, userId) VALUES (?, ?, ?, ?, ?)`,
                    [ad.title, ad.photo, ad.description, ad.isPremium, socket.id],
                    function (err) {
                        if (err) return console.error(err);

                        ad.id = this.lastID;
                        ad.userId = socket.id; // Привязываем к пользователю
                        io.emit('new-ad', ad); // Отправляем всем клиентам
                    }
                );

                // Обновляем время последнего объявления
                adCooldown.set(socket.id, now);
            }
        });
    });

    // Обработка удаления объявления
    socket.on('delete-ad', (id) => {
        db.get(`SELECT userId FROM ads WHERE id = ?`, [id], (err, row) => {
            if (err) return console.error(err);

            // Проверяем, что объявление существует и принадлежит пользователю
            if (!row) {
                socket.emit('error', 'Объявление не найдено!');
                return;
            }
            if (row.userId !== socket.id) {
                socket.emit('error', 'Вы не можете удалить чужое объявление!');
                return;
            }

            // Удаление объявления из базы
            db.run(`DELETE FROM ads WHERE id = ?`, [id], (err) => {
                if (err) return console.error(err);

                io.emit('delete-ad', id); // Уведомляем клиентов
            });
        });
    });

    // Обработка отключения пользователя
    socket.on('disconnect', () => {
        console.log('Пользователь отключен:', socket.id);
    });
});

// Запуск сервера
const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
});
