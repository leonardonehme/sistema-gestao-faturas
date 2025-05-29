const bcrypt = require('bcryptjs');
const saltRounds = 10;

async function generateHash() {
  const hash = await bcrypt.hash('admin123', saltRounds);
  console.log('Hash gerado:', hash);
  return hash;
}

generateHash();