const pool = require('../db');

async function seed() {
  try {
    // Inserir operadoras padrão
    await pool.query(`
      INSERT INTO operadoras (nome, contato, portal) VALUES
      ('UNI TELECOM', '69 3422-3511', 'https://sistema.souuni.com/central_assinante_web/login'),
      ('VOCE TELECOM', '96 9175-4483', 'https://sac.vocetelecom.com.br/'),
      ('OLLA TELECOM', '69 3219-4300', 'https://ixc.ollatelecom.com.br/central_assinante_web/login')
      ON CONFLICT (nome) DO NOTHING;
    `);

    // Inserir usuário admin
    const hashedPassword = await bcrypt.hash("admin123", 10);
    await pool.query(`
      INSERT INTO usuarios (username, password_hash, is_admin) 
      VALUES ('admin', $1, true)
      ON CONFLICT (username) DO NOTHING;
    `, [hashedPassword]);

    console.log('Dados iniciais inseridos com sucesso!');
  } catch (err) {
    console.error('Erro ao inserir dados iniciais:', err);
  } finally {
    pool.end();
  }
}

seed();