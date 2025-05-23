const express = require('express');
const cors = require('cors');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3001;

// Configurações de segurança
app.use(helmet());
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Configuração do CORS
const corsOptions = {
  origin: ['http://localhost:8080', 'https://seu-app.onrender.com'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};
app.use(cors(corsOptions));


app.options('*', cors(corsOptions));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100 // limite de 100 requisições por IP
});
app.use(limiter);

// Configurações de upload
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // Limite de 5MB
  },
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|pdf/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    
    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Apenas arquivos PDF, JPG, JPEG ou PNG são permitidos'));
  }
});

// Inicialização do banco de dados
async function setupDatabase() {
  const db = await open({
    filename: './database.sqlite',
    driver: sqlite3.Database
  });

  // Criação das tabelas
  await db.exec(`
    CREATE TABLE IF NOT EXISTS operadoras (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT UNIQUE NOT NULL,
      contato TEXT,
      portal TEXT,
      dia_vencimento INTEGER
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS faturas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operadora_id INTEGER,
      referencia TEXT NOT NULL,
      valor REAL NOT NULL,
      vencimento TEXT NOT NULL,
      status TEXT DEFAULT 'pendente',
      data_envio TEXT,
      enviado_para TEXT,
      comprovante_path TEXT,
      FOREIGN KEY (operadora_id) REFERENCES operadoras(id)
    );
  `);

  // Inserir operadoras padrão
  const count = await db.get('SELECT COUNT(*) as count FROM operadoras');
  if (count.count === 0) {
    const operadoras = [
      { nome: 'UNI TELECOM', contato: '69 3422-3511', portal: 'https://sistema.souuni.com/central_assinante_web/login' },
      { nome: 'VOCE TELECOM', contato: '96 9175-4483', portal: 'https://sac.vocetelecom.com.br/' },
      { nome: 'OLLA TELECOM', contato: '69 3219-4300', portal: 'https://ixc.ollatelecom.com.br/central_assinante_web/login' },
      { nome: 'SQUID NET', contato: '82 3352-5248', portal: 'https://ixc.squidtelecom.com.br/central_assinante_web/login' },
      { nome: 'BRISANET', contato: '88 8182-0637', portal: 'https://areadoassinante.brisanet.com.br/' },
      { nome: 'ORBITEL', contato: '61 8334-9691', portal: 'https://suporte.orbitel.com.br/account.php' },
      { nome: 'EMBRATEL', contato: '0800 721 1021', portal: 'https://www.embratel.com.br/espaco-cliente' }
    ];

    for (const op of operadoras) {
      await db.run(
        'INSERT INTO operadoras (nome, contato, portal) VALUES (?, ?, ?)',
        [op.nome, op.contato, op.portal]
      );
    }
  }

  return db;
}

// Rotas da API
async function setupRoutes(db) {
  // Middleware de verificação do banco
  app.use((req, res, next) => {
    req.db = db;
    next();
  });

  // Health Check
  app.get('/api/health', (req, res) => {
    res.json({ 
      status: 'OK', 
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development'
    });
  });

  // Operadoras
  app.get('/api/operadoras', async (req, res) => {
    try {
      const operadoras = await req.db.all('SELECT * FROM operadoras ORDER BY nome');
      res.json(operadoras);
    } catch (err) {
      console.error('Erro ao buscar operadoras:', err);
      res.status(500).json({ error: 'Erro ao buscar operadoras' });
    }
  });

  // Faturas com filtros
  app.get('/api/faturas', async (req, res) => {
    try {
      let query = `
        SELECT 
          f.*, 
          o.nome AS operadora_nome,
          o.contato AS operadora_contato,
          o.portal AS operadora_portal,
          CASE 
            WHEN f.status = 'enviado' THEN 'enviado'
            WHEN date(f.vencimento) < date('now') THEN 'vencido'
            WHEN julianday(f.vencimento) - julianday('now') <= 7 THEN 'proximo'
            ELSE 'pendente'
          END AS status_fatura
        FROM faturas f
        JOIN operadoras o ON f.operadora_id = o.id
      `;

      const conditions = [];
      const params = [];

      if (req.query.status) {
        if (req.query.status === 'enviado') {
          conditions.push("f.status = 'enviado'");
        } else if (req.query.status === 'vencido') {
          conditions.push("date(f.vencimento) < date('now') AND f.status != 'enviado'");
        } else if (req.query.status === 'proximo') {
          conditions.push("julianday(f.vencimento) - julianday('now') <= 7 AND date(f.vencimento) >= date('now') AND f.status != 'enviado'");
        } else if (req.query.status === 'pendente') {
          conditions.push("date(f.vencimento) >= date('now') AND f.status != 'enviado'");
        }
      }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }

      query += ' ORDER BY f.vencimento ASC';

      const faturas = await req.db.all(query, params);
      res.json(faturas);
    } catch (err) {
      console.error('Erro ao buscar faturas:', err);
      res.status(500).json({ error: 'Erro ao buscar faturas' });
    }
  });

  // Criar fatura
  app.post('/api/faturas', async (req, res) => {
    try {
      const { operadora_id, referencia, valor, vencimento } = req.body;

      if (!operadora_id || !referencia || !valor || !vencimento) {
        return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
      }

      const { lastID } = await req.db.run(
        'INSERT INTO faturas (operadora_id, referencia, valor, vencimento) VALUES (?, ?, ?, ?)',
        [operadora_id, referencia, parseFloat(valor), vencimento]
      );

      const novaFatura = await req.db.get(
        `SELECT f.*, o.nome AS operadora_nome FROM faturas f 
         JOIN operadoras o ON f.operadora_id = o.id 
         WHERE f.id = ?`,
        [lastID]
      );

      res.status(201).json(novaFatura);
    } catch (err) {
      console.error('Erro ao criar fatura:', err);
      res.status(500).json({ error: 'Erro ao criar fatura' });
    }
  });

  // Atualizar fatura
  app.put('/api/faturas/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { operadora_id, referencia, valor, vencimento } = req.body;

      const { changes } = await req.db.run(
        'UPDATE faturas SET operadora_id = ?, referencia = ?, valor = ?, vencimento = ? WHERE id = ?',
        [operadora_id, referencia, parseFloat(valor), vencimento, id]
      );

      if (changes === 0) {
        return res.status(404).json({ error: 'Fatura não encontrada' });
      }

      const faturaAtualizada = await req.db.get(
        `SELECT f.*, o.nome AS operadora_nome FROM faturas f 
         JOIN operadoras o ON f.operadora_id = o.id 
         WHERE f.id = ?`,
        [id]
      );

      res.json(faturaAtualizada);
    } catch (err) {
      console.error('Erro ao atualizar fatura:', err);
      res.status(500).json({ error: 'Erro ao atualizar fatura' });
    }
  });

  // Marcar como enviada
  app.put('/api/faturas/:id/enviar', upload.single('comprovante'), async (req, res) => {
    try {
      const { id } = req.params;
      const { enviado_para } = req.body;

      if (!enviado_para) {
        return res.status(400).json({ error: 'Campo "enviado_para" é obrigatório' });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'Comprovante é obrigatório' });
      }

      const comprovantePath = `/uploads/${req.file.filename}`;

      const { changes } = await req.db.run(
        `UPDATE faturas 
         SET status = 'enviado', 
             enviado_para = ?, 
             comprovante_path = ?, 
             data_envio = datetime('now') 
         WHERE id = ?`,
        [enviado_para, comprovantePath, id]
      );

      if (changes === 0) {
        // Remove o arquivo se a atualização falhou
        fs.unlinkSync(path.join(UPLOADS_DIR, req.file.filename));
        return res.status(404).json({ error: 'Fatura não encontrada' });
      }

      res.json({ success: true, message: 'Fatura marcada como enviada' });
    } catch (err) {
      console.error('Erro ao marcar fatura como enviada:', err);
      
      // Remove o arquivo em caso de erro
      if (req.file) {
        fs.unlinkSync(path.join(UPLOADS_DIR, req.file.filename));
      }
      
      res.status(500).json({ error: 'Erro ao marcar fatura como enviada' });
    }
  });

  // Excluir fatura
  app.delete('/api/faturas/:id', async (req, res) => {
    try {
      const { id } = req.params;
      
      const fatura = await req.db.get(
        'SELECT comprovante_path FROM faturas WHERE id = ?', 
        [id]
      );
      
      if (!fatura) {
        return res.status(404).json({ error: 'Fatura não encontrada' });
      }

      // Exclui o arquivo se existir
      if (fatura.comprovante_path) {
        const filePath = path.join(__dirname, fatura.comprovante_path);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }

      const { changes } = await req.db.run(
        'DELETE FROM faturas WHERE id = ?', 
        [id]
      );
      
      if (changes === 0) {
        return res.status(404).json({ error: 'Fatura não encontrada' });
      }

      res.json({ success: true, message: 'Fatura excluída com sucesso' });
    } catch (err) {
      console.error('Erro ao excluir fatura:', err);
      res.status(500).json({ error: 'Erro ao excluir fatura' });
    }
  });

  // Notificações
  app.get('/api/notificacoes', async (req, res) => {
    try {
      const hoje = new Date().toISOString().split('T')[0];
      const seteDias = new Date();
      seteDias.setDate(seteDias.getDate() + 7);
      const seteDiasStr = seteDias.toISOString().split('T')[0];

      const faturasProximas = await req.db.all(
        `SELECT f.id, f.referencia, f.vencimento, o.nome AS operadora_nome 
         FROM faturas f
         JOIN operadoras o ON f.operadora_id = o.id
         WHERE f.status != 'enviado' 
         AND date(f.vencimento) BETWEEN date(?) AND date(?)
         ORDER BY f.vencimento ASC`,
        [hoje, seteDiasStr]
      );

      res.json(faturasProximas);
    } catch (err) {
      console.error('Erro ao buscar notificações:', err);
      res.status(500).json({ error: 'Erro ao buscar notificações' });
    }
  });

  // Rota para servir arquivos estáticos (se necessário)
  app.use('/uploads', express.static(UPLOADS_DIR));
}

// Inicialização do servidor
(async () => {
  try {
    const db = await setupDatabase();
    await setupRoutes(db);

    app.listen(PORT, () => {
      console.log(`🚀 Servidor rodando na porta ${PORT}`);
      console.log(`🔗 Acesse: http://localhost:${PORT}`);
      console.log(`⚙️  Modo: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (err) {
    console.error('❌ Falha ao iniciar o servidor:', err);
    process.exit(1);
  }
})();