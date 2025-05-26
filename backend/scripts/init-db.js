const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('../database.sqlite');

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL
    )
  `, (err) => {
    if (err) {
      console.error('❌ Erro ao criar tabela:', err.message);
    } else {
      console.log('✅ Tabela "users" criada com sucesso!');
    }
    db.close();
  });
});
