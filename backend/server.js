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
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Configurações de segurança
app.use(helmet());
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Configuração do CORS
const corsOptions = {
  origin: [
    'http://localhost:8080', 
    'http://127.0.0.1:5500',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'https://seu-app.onrender.com'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Middleware de log para debug
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log('Body:', req.body);
  }
  next();
});

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
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
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|pdf/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    
    if (mimetype && extname) return cb(null, true);
    cb(new Error('Apenas arquivos PDF, JPG, JPEG ou PNG são permitidos'));
  }
});

// Inicialização do banco de dados
async function setupDatabase() {
  const db = await open({
    filename: process.env.NODE_ENV === 'production' 
      ? '/data/database.sqlite' 
      : './database.sqlite',
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

  await db.exec(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      is_admin BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

  // Inserir usuário admin padrão
  const adminExists = await db.get('SELECT 1 FROM usuarios WHERE username = "admin"');
  if (!adminExists) {
    const hashedPassword = await bcrypt.hash("admin123", 10);
    await db.run(
      'INSERT INTO usuarios (username, password_hash, is_admin) VALUES (?, ?, ?)',
      ['admin', hashedPassword, true]
    );
    console.log('Usuário admin criado com senha: admin123');
  }

  return db;
}

// Middleware de autenticação
function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ 
      error: 'Token de acesso não fornecido',
      solution: 'Inclua o token no header Authorization: Bearer <token>'
    });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ 
        error: 'Token inválido ou expirado',
        details: err.message
      });
    }
    req.user = user;
    next();
  });
}

// Middleware para verificar admin
function isAdmin(req, res, next) {
    if (!req.user.isAdmin) {
        return res.status(403).json({ 
            error: 'Acesso restrito a administradores',
            user: req.user
        });
    }
    next();
}

// Rotas da API
async function setupRoutes(db) {
  // Middleware para injetar db nas requisições
  app.use((req, res, next) => {
    req.db = db;
    next();
  });

  // Rota de login
  app.post('/api/login', async (req, res) => {
    try {
      if (!req.body || Object.keys(req.body).length === 0) {
        return res.status(400).json({ error: 'Corpo da requisição vazio ou inválido' });
      }

      const { username, password } = req.body;
      
      if (!username || !password) {
        return res.status(400).json({ error: 'Usuário e senha são obrigatórios' });
      }

      const user = await db.get('SELECT * FROM usuarios WHERE username = ?', [username]);
      
      if (!user) {
        return res.status(401).json({ error: 'Credenciais inválidas' });
      }

      const passwordMatch = await bcrypt.compare(password, user.password_hash);
      
      if (!passwordMatch) {
        return res.status(401).json({ error: 'Credenciais inválidas' });
      }

      const token = jwt.sign(
        { 
          id: user.id, 
          username: user.username, 
          isAdmin: user.is_admin 
        },
        process.env.JWT_SECRET,
        { expiresIn: '8h' }
      );

      res.json({ 
        token,
        user: {
          id: user.id,
          username: user.username,
          isAdmin: user.is_admin
        }
      });

    } catch (err) {
      console.error('Erro no login:', err);
      res.status(500).json({ error: 'Erro ao processar login' });
    }
  });

  // Rota para verificar token
  app.get('/api/validate-token', authenticate, (req, res) => {
    res.json({ 
      valid: true,
      user: req.user
    });
  });

  // Rotas de usuários
app.post('/api/usuarios', authenticate, isAdmin, async (req, res) => {
    try {
        const { username, password, isAdmin } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Usuário e senha são obrigatórios' });
        }

        // Verifica se o usuário já existe
        const existingUser = await db.get('SELECT 1 FROM usuarios WHERE username = ?', [username]);
        if (existingUser) {
            return res.status(400).json({ error: 'Usuário já existe' });
        }

        // Criptografa a senha
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Insere no banco de dados
        const { lastID } = await db.run(
            'INSERT INTO usuarios (username, password_hash, is_admin) VALUES (?, ?, ?)',
            [username, hashedPassword, Boolean(isAdmin)]
        );

        // Retorna o novo usuário (sem a senha)
        const newUser = await db.get('SELECT id, username, is_admin FROM usuarios WHERE id = ?', [lastID]);
        res.status(201).json(newUser);

    } catch (err) {
        console.error('Erro ao criar usuário:', err);
        res.status(500).json({ error: 'Erro ao criar usuário' });
    }
});

  app.get('/api/usuarios', authenticate, isAdmin, async (req, res) => {
    try {
      const users = await db.all('SELECT id, username, is_admin, created_at FROM usuarios');
      res.json(users);
    } catch (err) {
      console.error('Erro ao listar usuários:', err);
      res.status(500).json({ error: 'Erro ao listar usuários' });
    }
  });

  // Rotas de operadoras
  app.get('/api/operadoras', authenticate, async (req, res) => {
    try {
      const operadoras = await db.all('SELECT * FROM operadoras ORDER BY nome');
      res.json(operadoras);
    } catch (err) {
      console.error('Erro ao buscar operadoras:', err);
      res.status(500).json({ error: 'Erro ao buscar operadoras' });
    }
  });

  // Rotas de faturas
  app.get('/api/faturas', authenticate, async (req, res) => {
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

      const faturas = await db.all(query, params);
      res.json(faturas);
    } catch (err) {
      console.error('Erro ao buscar faturas:', err);
      res.status(500).json({ error: 'Erro ao buscar faturas' });
    }
  });

  app.post('/api/faturas', authenticate, async (req, res) => {
    try {
      const { operadora_id, referencia, valor, vencimento } = req.body;
      
      if (!operadora_id || !referencia || !valor || !vencimento) {
        return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
      }

      const { lastID } = await db.run(
        'INSERT INTO faturas (operadora_id, referencia, valor, vencimento) VALUES (?, ?, ?, ?)',
        [operadora_id, referencia, valor, vencimento]
      );

      const novaFatura = await db.get(
        'SELECT f.*, o.nome AS operadora_nome FROM faturas f JOIN operadoras o ON f.operadora_id = o.id WHERE f.id = ?',
        [lastID]
      );

      res.status(201).json(novaFatura);
    } catch (err) {
      console.error('Erro ao criar fatura:', err);
      res.status(500).json({ error: 'Erro ao criar fatura' });
    }
  });

  app.get('/api/faturas/:id', authenticate, async (req, res) => {
    try {
      const { id } = req.params;
      
      const fatura = await db.get(
        'SELECT f.*, o.nome AS operadora_nome FROM faturas f JOIN operadoras o ON f.operadora_id = o.id WHERE f.id = ?',
        [id]
      );

      if (!fatura) {
        return res.status(404).json({ error: 'Fatura não encontrada' });
      }

      res.json(fatura);
    } catch (err) {
      console.error('Erro ao buscar fatura:', err);
      res.status(500).json({ error: 'Erro ao buscar fatura' });
    }
  });

  app.put('/api/faturas/:id', authenticate, async (req, res) => {
    try {
      const { id } = req.params;
      const { operadora_id, referencia, valor, vencimento } = req.body;
      
      if (!operadora_id || !referencia || !valor || !vencimento) {
        return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
      }

      await db.run(
        'UPDATE faturas SET operadora_id = ?, referencia = ?, valor = ?, vencimento = ? WHERE id = ?',
        [operadora_id, referencia, valor, vencimento, id]
      );

      const faturaAtualizada = await db.get(
        'SELECT f.*, o.nome AS operadora_nome FROM faturas f JOIN operadoras o ON f.operadora_id = o.id WHERE f.id = ?',
        [id]
      );

      res.json(faturaAtualizada);
    } catch (err) {
      console.error('Erro ao atualizar fatura:', err);
      res.status(500).json({ error: 'Erro ao atualizar fatura' });
    }
  });

  app.put('/api/faturas/:id/enviar', authenticate, upload.single('comprovante'), async (req, res) => {
    try {
      const { id } = req.params;
      const { enviado_para } = req.body;
      const comprovante_path = req.file ? `/uploads/${req.file.filename}` : null;

      if (!enviado_para) {
        return res.status(400).json({ error: 'Campo "enviado_para" é obrigatório' });
      }

      await db.run(
        'UPDATE faturas SET status = "enviado", data_envio = datetime("now"), enviado_para = ?, comprovante_path = ? WHERE id = ?',
        [enviado_para, comprovante_path, id]
      );

      const faturaAtualizada = await db.get(
        'SELECT f.*, o.nome AS operadora_nome FROM faturas f JOIN operadoras o ON f.operadora_id = o.id WHERE f.id = ?',
        [id]
      );

      res.json(faturaAtualizada);
    } catch (err) {
      console.error('Erro ao marcar fatura como enviada:', err);
      res.status(500).json({ error: 'Erro ao marcar fatura como enviada' });
    }
  });

  // Atualize a rota existente para exigir admin
  app.delete('/api/faturas/:id', authenticate, isAdmin, async (req, res) => {
      try {
          const { id } = req.params;
          
          const fatura = await db.get('SELECT * FROM faturas WHERE id = ?', [id]);
          if (!fatura) {
              return res.status(404).json({ error: 'Fatura não encontrada' });
          }

          if (fatura.comprovante_path) {
              const filePath = path.join(__dirname, fatura.comprovante_path);
              if (fs.existsSync(filePath)) {
                  fs.unlinkSync(filePath);
              }
          }

          await db.run('DELETE FROM faturas WHERE id = ?', [id]);
          res.json({ success: true });
      } catch (err) {
          console.error('Erro ao excluir fatura:', err);
          res.status(500).json({ error: 'Erro ao excluir fatura' });
      }
  });

  // Notificações
  app.get('/api/notificacoes', authenticate, async (req, res) => {
    try {
      const hoje = new Date().toISOString().split('T')[0];
      const seteDias = new Date();
      seteDias.setDate(seteDias.getDate() + 7);
      const seteDiasStr = seteDias.toISOString().split('T')[0];

      const faturasProximas = await db.all(
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

  // Servir arquivos estáticos
  app.use('/uploads', express.static(UPLOADS_DIR));
  app.use(express.static(path.join(__dirname, '../frontend')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
  });

  // Rota para excluir usuário
  app.delete('/api/usuarios/:id', authenticate, isAdmin, async (req, res) => {
      try {
          const { id } = req.params;
          
          // Não permitir que o admin se exclua
          if (req.user.id === parseInt(id)) {
              return res.status(400).json({ error: 'Você não pode excluir a si mesmo' });
          }

          await db.run('DELETE FROM usuarios WHERE id = ?', [id]);
          res.json({ success: true });
      } catch (err) {
          console.error('Erro ao excluir usuário:', err);
          res.status(500).json({ error: 'Erro ao excluir usuário' });
      }
  });
}

// Inicialização do servidor
(async () => {
  try {
    if (!process.env.JWT_SECRET) {
      throw new Error('Variável JWT_SECRET não configurada no arquivo .env');
    }

    const db = await setupDatabase();
    await setupRoutes(db);

    app.listen(PORT, () => {
      console.log(`🚀 Servidor rodando na porta ${PORT}`);
      console.log(`🔗 Acesse: http://localhost:${PORT}`);
      console.log('Usuário admin padrão: admin / admin123');
    });
  } catch (err) {
    console.error('❌ Falha ao iniciar o servidor:', err);
    process.exit(1);
  }
})();