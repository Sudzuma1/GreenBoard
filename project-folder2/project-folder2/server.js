const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Подключение к базе данных
const db = new sqlite3.Database('./ads.db');

// Создание таблиц
db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT
)`);

db.run(`CREATE TABLE IF NOT EXISTS ads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    photo TEXT,
    description TEXT,
    isPremium BOOLEAN,
    userId INTEGER,
    FOREIGN KEY(userId) REFERENCES users(id)
)`);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'secret_key',
    resave: false,
    saveUninitialized: true,
    store: new SQLiteStore({ db: 'sessions.db', dir: './' }),
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, 'public')));

// Регистрация
app.post('/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Заполните все поля' });

    bcrypt.hash(password, 10, (err, hash) => {
        if (err) return res.status(500).json({ error: 'Ошибка сервера' });

        db.run(`INSERT INTO users (username, password) VALUES (?, ?)`, [username, hash], (err) => {
            if (err) return res.status(400).json({ error: 'Пользователь уже существует' });
            res.json({ success: true });
        });
    });
});

// Авторизация
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, user) => {
        if (err || !user) return res.status(400).json({ error: 'Неверные данные' });
        
        bcrypt.compare(password, user.password, (err, result) => {
            if (result) {
                req.session.userId = user.id;
                res.json({ success: true });
            } else {
                res.status(400).json({ error: 'Неверные данные' });
            }
        });
    });
});

// WebSocket соединение
io.on('connection', (socket) => {
    console.log('Пользователь подключен:', socket.id);

    db.all(`SELECT * FROM ads`, (err, rows) => {
        if (err) return console.error(err);
        socket.emit('initial-ads', rows);
    });

    socket.on('new-ad', (ad) => {
        if (!ad.userId) {
            socket.emit('error', 'Вы не авторизованы');
            return;
        }

        db.run(`INSERT INTO ads (title, photo, description, isPremium, userId) VALUES (?, ?, ?, ?, ?)`,
            [ad.title, ad.photo, ad.description, ad.isPremium, ad.userId],
            function (err) {
                if (err) return console.error(err);
                ad.id = this.lastID;
                io.emit('new-ad', ad);
            }
        );
    });

    socket.on('delete-ad', (data) => {
        db.get(`SELECT userId FROM ads WHERE id = ?`, [data.adId], (err, row) => {
            if (err || !row || row.userId !== data.userId) {
                socket.emit('error', 'Вы не можете удалить это объявление');
                return;
            }

            db.run(`DELETE FROM ads WHERE id = ?`, [data.adId], (err) => {
                if (err) return console.error(err);
                io.emit('delete-ad', data.adId);
            });
        });
    });

    socket.on('disconnect', () => {
        console.log('Пользователь отключен:', socket.id);
    });
});

// Запуск сервера
const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
});
