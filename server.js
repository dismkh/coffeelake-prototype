const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Подключение к вашей базе данных PostgreSQL
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'coffeelake_db',
    password: 'ICTP', // <--- ВПИШИТЕ ВАШ ПАРОЛЬ ОТ POSTGRESQL!
    port: 5432,
});

// 1. READ OPERATION: Поиск и загрузка меню из базы
app.get('/api/menu', async (req, res) => {
    const { search } = req.query;
    try {
        let queryText = `
            SELECT m.item_id, m.name, m.volume_ml, m.price_kzt, c.category_name 
            FROM menu_items m
            JOIN categories c ON m.category_id = c.category_id
            WHERE m.is_available = TRUE
        `;
        const queryParams = [];

        if (search && search.trim() !== '') {
            queryText += ` AND (m.name ILIKE $1 OR c.category_name ILIKE $1)`;
            queryParams.push(`%${search.trim()}%`);
        }

        queryText += ` ORDER BY c.category_id ASC, m.item_id ASC;`;

        const result = await pool.query(queryText, queryParams);
        res.json({ success: true, count: result.rows.length, data: result.rows });
    } catch (err) {
        console.error('Database Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 2. WRITE OPERATION: Сохранение заказа в PostgreSQL
app.post('/api/orders', async (req, res) => {
    const { userId, items, totalPrice, customizationNotes } = req.body;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Создание записи в таблице orders
        const orderRes = await client.query(`
            INSERT INTO orders (user_id, pickup_time, total_price, order_status)
            VALUES ($1, NOW() + INTERVAL '15 minutes', $2, 'Created')
            RETURNING order_id;
        `, [userId || 1, totalPrice]);

        const newOrderId = orderRes.rows[0].order_id;

        // Добавление элементов в order_items
        for (const item of items) {
            await client.query(`
                INSERT INTO order_items (order_id, item_id, quantity, unit_price, customization_notes)
                VALUES ($1, $2, $3, $4, $5);
            `, [newOrderId, item.itemId, item.quantity || 1, item.price, customizationNotes || null]);
        }

        // Обновление программы лояльности (R8)
        await client.query(`
            UPDATE users SET loyalty_counter = loyalty_counter + 1 WHERE user_id = $1;
        `, [userId || 1]);

        await client.query('COMMIT');
        res.json({ success: true, orderId: newOrderId });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Order Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

const PORT = 5000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});