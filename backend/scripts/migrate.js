const path = require('path');
const fs = require('fs');
const pool = require('./../db');  // Corrigido o caminho

async function runMigrations() {
  const client = await pool.connect();
  try {
    const migrationFiles = fs.readdirSync(path.join(__dirname, '../migrations'))
      .filter(file => file.endsWith('.sql'))
      .sort();

    for (const file of migrationFiles) {
      const sql = fs.readFileSync(path.join(__dirname, `../migrations/${file}`), 'utf8');
      await client.query(sql);
      console.log(`Migration ${file} executed successfully`);
    }
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations();