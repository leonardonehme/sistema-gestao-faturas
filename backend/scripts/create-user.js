const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

const db = new sqlite3.Database('../database.sqlite');

const username = 'admin';       // Pode trocar se quiser
const password = '123456';      // Pode trocar se quiser

bcrypt.hash(password, 10, (err, hash) => {
  if (err) {
    return console.error('Erro ao gerar hash da senha:', err);
  }

  const query = `INSERT INTO users (username, password) VALUES (?, ?)`;

  db.run(query, [username, hash], function(err) {
    if (err) {
      console.error('❌ Erro ao inserir usuário:', err.message);
    } else {
      console.log(`✅ Usuário '${username}' criado com sucesso!`);
    }
    db.close();
  });
});
