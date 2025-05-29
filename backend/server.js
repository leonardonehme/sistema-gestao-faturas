const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('./db');
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
    console.log('Body:', JSON.stringify(req.body, null, 2));
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

// Middleware para injetar pool nas requisições
app.use((req, res, next) => {
  req.db = pool;
  next();
});

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

// Rota de login
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Usuário e senha são obrigatórios' });
    }

    const { rows } = await pool.query('SELECT * FROM usuarios WHERE username = $1', [username.trim()]);
    const user = rows[0];
    
    if (!user) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const passwordMatch = await bcrypt.compare(password.trim(), user.senha_hash);
    
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
    res.status(500).json({ error: 'Erro ao processar login', details: err.message });
  }
});

// Rota para refresh token
app.post('/api/refresh-token', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM usuarios WHERE id = $1', [req.user.id]);
    const user = rows[0];
    
    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const newToken = jwt.sign(
      { 
        id: user.id, 
        username: user.username, 
        isAdmin: user.is_admin 
      },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({ token: newToken });
  } catch (err) {
    console.error('Erro ao renovar token:', err);
    res.status(500).json({ error: 'Erro ao renovar token', details: err.message });
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
        const { username, password, nome = '', isAdmin = false } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ 
                error: 'Usuário e senha são obrigatórios',
                required: ['username', 'password']
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        
        const result = await pool.query(
            `INSERT INTO usuarios 
             (username, senha_hash, is_admin, nome) 
             VALUES ($1, $2, $3, $4) 
             RETURNING id, username, is_admin, nome`,
            [username, hashedPassword, Boolean(isAdmin), nome]
        );

        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Erro ao criar usuário:', err);
        res.status(500).json({ 
            error: 'Erro ao criar usuário',
            details: err.message 
        });
    }
});

app.get('/api/usuarios', authenticate, isAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, username, is_admin, criado_em FROM usuarios');
    res.json(rows);
  } catch (err) {
    console.error('Erro ao listar usuários:', err);
    res.status(500).json({ error: 'Erro ao listar usuários', details: err.message });
  }
});

// Rotas de operadoras
app.get('/api/operadoras', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM operadoras ORDER BY nome');
    res.json(rows);
  } catch (err) {
    console.error('Erro ao buscar operadoras:', err);
    res.status(500).json({ error: 'Erro ao buscar operadoras', details: err.message });
  }
});

// Rotas de faturas
app.get('/api/faturas', authenticate, async (req, res) => {
  try {
    let query = `
      SELECT 
        f.id,
        f.operadora_id,
        f.referencia,
        f.valor,
        f.vencimento,
        f.status,
        f.data_envio,
        f.enviado_para,
        f.comprovante_path,
        f.usuario_id,
        f.criado_em,
        o.nome AS operadora_nome,
        o.contato AS operadora_contato,
        o.portal AS operadora_portal,
        CASE 
          WHEN f.status = 'enviado' THEN 'enviado'
          WHEN f.vencimento < CURRENT_DATE THEN 'vencido'
          WHEN (f.vencimento - CURRENT_DATE) <= 7 THEN 'proximo'
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
        conditions.push("f.vencimento < CURRENT_DATE AND f.status != 'enviado'");
      } else if (req.query.status === 'proximo') {
        conditions.push("(f.vencimento - CURRENT_DATE) <= 7 AND f.vencimento >= CURRENT_DATE AND f.status != 'enviado'");
      } else if (req.query.status === 'pendente') {
        conditions.push("f.vencimento >= CURRENT_DATE AND f.status != 'enviado'");
      }
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY f.vencimento ASC';

    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Erro ao buscar faturas:', err);
    res.status(500).json({ error: 'Erro ao buscar faturas', details: err.message });
  }
});

app.post('/api/faturas', authenticate, async (req, res) => {
  try {
    const { operadora_id, referencia, valor, vencimento } = req.body;
    
    // Validação reforçada
    if (!operadora_id || !referencia || !valor || !vencimento) {
      return res.status(400).json({ 
        error: 'Todos os campos são obrigatórios',
        required: ['operadora_id', 'referencia', 'valor', 'vencimento']
      });
    }

    // Verifica se a operadora existe
    const operadoraCheck = await pool.query('SELECT 1 FROM operadoras WHERE id = $1', [operadora_id]);
    if (operadoraCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Operadora não encontrada' });
    }

    const result = await pool.query(
      `INSERT INTO faturas 
       (operadora_id, referencia, valor, vencimento, usuario_id, status) 
       VALUES ($1, $2, $3, $4, $5, 'pendente')
       RETURNING *`,
      [operadora_id, referencia, parseFloat(valor), vencimento, req.user.id]
    );

    // Obter dados completos da fatura com nome da operadora
    const faturaCompleta = await pool.query(
      `SELECT f.*, o.nome AS operadora_nome 
       FROM faturas f 
       JOIN operadoras o ON f.operadora_id = o.id 
       WHERE f.id = $1`,
      [result.rows[0].id]
    );

    res.status(201).json(faturaCompleta.rows[0]);
  } catch (err) {
    console.error('Erro ao criar fatura:', err);
    
    // Tratamento específico para erros de banco de dados
    if (err.code === '23502') { // Violação de NOT NULL
      const column = err.column || 'coluna desconhecida';
      return res.status(400).json({ 
        error: `Campo obrigatório faltando: ${column}`,
        details: err.message
      });
    }
    
    res.status(500).json({ 
      error: 'Erro ao criar fatura',
      details: err.message 
    });
  }
});

app.get('/api/faturas/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    const { rows } = await pool.query(
      'SELECT f.*, o.nome AS operadora_nome FROM faturas f JOIN operadoras o ON f.operadora_id = o.id WHERE f.id = $1',
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Fatura não encontrada' });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('Erro ao buscar fatura:', err);
    res.status(500).json({ error: 'Erro ao buscar fatura', details: err.message });
  }
});

// Atualize a rota de criação de faturas
app.post('/api/faturas', authenticate, async (req, res) => {
  try {
    const { operadora_id, referencia, valor, vencimento } = req.body;
    
    // Verifique se o usuário ainda está autenticado
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    if (!operadora_id || !referencia || !valor || !vencimento) {
      return res.status(400).json({ 
        error: 'Todos os campos são obrigatórios',
        required: ['operadora_id', 'referencia', 'valor', 'vencimento']
      });
    }

    // Verifique se o token ainda é válido
    try {
      jwt.verify(req.headers.authorization.split(' ')[1], process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ error: 'Token expirado', details: err.message });
    }

    const result = await pool.query(
      `INSERT INTO faturas 
       (operadora_id, referencia, valor, vencimento, usuario_id, status) 
       VALUES ($1, $2, $3, $4, $5, 'pendente')
       RETURNING *`,
      [operadora_id, referencia, parseFloat(valor), vencimento, req.user.id]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Erro ao criar fatura:', err);
    
    if (err.code === '23502') { // Violação de NOT NULL
      return res.status(400).json({ 
        error: `Campo obrigatório faltando: ${err.column}`,
        details: err.message
      });
    }
    
    res.status(500).json({ 
      error: 'Erro ao criar fatura',
      details: err.message 
    });
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

    await pool.query(
      `UPDATE faturas 
       SET status = 'enviado', data_envio = NOW(), enviado_para = $1, comprovante_path = $2 
       WHERE id = $3`,
      [enviado_para, comprovante_path, id]
    );

    const { rows } = await pool.query(
      'SELECT f.*, o.nome AS operadora_nome FROM faturas f JOIN operadoras o ON f.operadora_id = o.id WHERE f.id = $1',
      [id]
    );

    res.json(rows[0]);
  } catch (err) {
    console.error('Erro ao marcar fatura como enviada:', err);
    res.status(500).json({ error: 'Erro ao marcar fatura como enviada', details: err.message });
  }
});

app.delete('/api/faturas/:id', authenticate, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    const { rows } = await pool.query('SELECT * FROM faturas WHERE id = $1', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Fatura não encontrada' });
    }

    const fatura = rows[0];
    if (fatura.comprovante_path) {
      const filePath = path.join(__dirname, fatura.comprovante_path);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    await pool.query('DELETE FROM faturas WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao excluir fatura:', err);
    res.status(500).json({ error: 'Erro ao excluir fatura', details: err.message });
  }

  // Adicione esta rota para upload de comprovante separadamente
    app.post('/api/faturas/:id/comprovante', authenticate, upload.single('comprovante'), async (req, res) => {
      try {
        const { id } = req.params;
        const { enviado_para } = req.body;
        
        if (!req.file) {
          return res.status(400).json({ error: 'Nenhum comprovante enviado' });
        }

        const comprovante_path = '/uploads/' + req.file.filename;

        const result = await pool.query(
          `UPDATE faturas 
          SET status = 'enviado', 
              data_envio = NOW(), 
              enviado_para = $1, 
              comprovante_path = $2 
          WHERE id = $3
          RETURNING *`,
          [enviado_para, comprovante_path, id]
        );

        if (result.rows.length === 0) {
          return res.status(404).json({ error: 'Fatura não encontrada' });
        }

        res.json(result.rows[0]);
      } catch (err) {
        console.error('Erro ao enviar comprovante:', err);
        res.status(500).json({ 
          error: 'Erro ao enviar comprovante',
          details: err.message 
        });
      }
    });


});

// Notificações
app.get('/api/notificacoes', authenticate, async (req, res) => {
  try {
    const hoje = new Date().toISOString().split('T')[0];
    const seteDias = new Date();
    seteDias.setDate(seteDias.getDate() + 7);
    const seteDiasStr = seteDias.toISOString().split('T')[0];

    const { rows } = await pool.query(
      `SELECT f.id, f.referencia, f.vencimento, o.nome AS operadora_nome 
       FROM faturas f
       JOIN operadoras o ON f.operadora_id = o.id
       WHERE f.status != 'enviado' 
       AND f.vencimento BETWEEN $1 AND $2
       ORDER BY f.vencimento ASC`,
      [hoje, seteDiasStr]
    );

    res.json(rows);
  } catch (err) {
    console.error('Erro ao buscar notificações:', err);
    res.status(500).json({ error: 'Erro ao buscar notificações', details: err.message });
  }
});

// Rota para excluir usuário
app.delete('/api/usuarios/:id', authenticate, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (req.user.id === parseInt(id)) {
      return res.status(400).json({ error: 'Você não pode excluir a si mesmo' });
    }

    await pool.query('DELETE FROM usuarios WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao excluir usuário:', err);
    res.status(500).json({ error: 'Erro ao excluir usuário', details: err.message });
  }
});

// Servir arquivos estáticos
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname, '../frontend')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Inicialização do servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`🔗 Acesse: http://localhost:${PORT}`);

  // Verifica e cria usuário admin se não existir
  (async () => {
    try {
      const { rows } = await pool.query('SELECT 1 FROM usuarios WHERE username = $1', ['admin']);
      if (rows.length === 0) {
        const hashedPassword = await bcrypt.hash('admin123', 10);
        await pool.query(
          'INSERT INTO usuarios (username, senha_hash, is_admin) VALUES ($1, $2, $3)',
          ['admin', hashedPassword, true]
        );
        console.log('Usuário admin criado com senha: admin123');
      }
    } catch (err) {
      console.error('Erro ao verificar/criar usuário admin:', err);
    }
  })();
});