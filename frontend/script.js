// Configuração da API base
const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:3001'
  : 'https://seu-app.onrender.com';

// Tempo de tolerância para expiração do token (em segundos)
const TOKEN_EXPIRATION_BUFFER = 300; // 5 minutos

// Estado da aplicação
let currentFaturaId = null;
let listaFaturas = [];
let operadoras = [];
let refreshInProgress = false;
let usuariosCadastrados = [];

// Cache de elementos DOM
const elements = {
    modal: document.getElementById('modalFatura'),
    form: document.getElementById('formFatura'),
    btnNovaFatura: document.getElementById('btnNovaFatura'),
    spanClose: document.querySelector('.close'),
    filterStatus: document.getElementById('filterStatus'),
    operadora: document.getElementById('operadora'),
    referencia: document.getElementById('referencia'),
    valor: document.getElementById('valor'),
    vencimento: document.getElementById('vencimento'),
    enviadoPara: document.getElementById('enviadoPara'),
    comprovante: document.getElementById('comprovante'),
    envioFields: document.getElementById('envioFields'),
    modalTitle: document.getElementById('modalTitle'),
    btnSubmit: document.getElementById('btnSubmit'),
    tbody: document.querySelector('#tabelaFaturas tbody'),
    countPending: document.getElementById('countPending'),
    countDueSoon: document.getElementById('countDueSoon'),
    countOverdue: document.getElementById('countOverdue'),
    notificacoesContainer: document.getElementById('notificacoesContainer'),
    notificacoesList: document.getElementById('notificacoesList'),
    notificacoesBadge: document.getElementById('notificacoesBadge'),
    usernameDisplay: document.getElementById('usernameDisplay'),
    loadingIndicator: document.getElementById('loadingIndicator')
};

// ==================== FUNÇÕES DE AUTENTICAÇÃO ====================

// Verifica se o token está expirado ou prestes a expirar
function isTokenExpired(token) {
    if (!token) return true;
    try {
        const decoded = JSON.parse(atob(token.split('.')[1]));
        const now = Date.now() / 1000;
        return decoded.exp < (now + TOKEN_EXPIRATION_BUFFER);
    } catch (e) {
        return true;
    }
}

// Função para fazer requisições autenticadas com tratamento de token
async function fetchAuth(url, options = {}) {
    let token = localStorage.getItem('authToken');
    
    // Se não tem token ou está expirado, tenta renovar
    if (!token || isTokenExpired(token)) {
        try {
            if (!refreshInProgress) {
                refreshInProgress = true;
                const refreshed = await tryRefreshToken();
                refreshInProgress = false;
                
                if (!refreshed) {
                    logout();
                    throw new Error('Sessão expirada. Por favor, faça login novamente.');
                }
                token = localStorage.getItem('authToken');
            }
        } catch (error) {
            refreshInProgress = false;
            logout();
            throw error;
        }
    }
    
    const defaultOptions = {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        ...options
    };
    
    try {
        const response = await fetch(`${API_BASE}${url}`, defaultOptions);
        
        // Se token expirou durante a requisição
        if (response.status === 401) {
            // Tenta renovar apenas uma vez
            try {
                const refreshed = await tryRefreshToken();
                if (!refreshed) {
                    logout();
                    throw new Error('Sessão expirada. Por favor, faça login novamente.');
                }
                
                // Atualiza o token no header e repete a requisição
                defaultOptions.headers.Authorization = `Bearer ${localStorage.getItem('authToken')}`;
                const newResponse = await fetch(`${API_BASE}${url}`, defaultOptions);
                
                if (!newResponse.ok) {
                    const errorText = await newResponse.text();
                    throw new Error(errorText || 'Erro na requisição');
                }
                
                return await newResponse.json();
            } catch (refreshError) {
                logout();
                throw refreshError;
            }
        }
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText || 'Erro na requisição');
        }
        
        return await response.json();
    } catch (error) {
        console.error(`Erro na requisição para ${url}:`, error);
        throw error;
    }
}

// Tenta renovar o token (fallback para login novamente se não houver endpoint de refresh)
async function tryRefreshToken() {
    const token = localStorage.getItem('authToken');
    const user = JSON.parse(localStorage.getItem('user'));
    
    if (!token || !user) return false;

    try {
        // 1. Primeiro tenta usar endpoint de refresh se existir
        try {
            const refreshResponse = await fetch(`${API_BASE}/api/refresh-token`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (refreshResponse.ok) {
                const data = await refreshResponse.json();
                localStorage.setItem('authToken', data.token);
                return true;
            }
        } catch (e) {
            console.log('Endpoint de refresh não disponível, tentando login...');
        }
        
        // 2. Fallback: Faz login novamente (não ideal para produção)
        const loginResponse = await fetch(`${API_BASE}/api/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                username: user.username,
                password: user.password // AVISO: Isso não é seguro para produção!
            })
        });
        
        if (loginResponse.ok) {
            const data = await loginResponse.json();
            localStorage.setItem('authToken', data.token);
            return true;
        }
        
        return false;
    } catch (error) {
        console.error('Erro ao renovar token:', error);
        return false;
    }
}

// Função de logout melhorada
function logout(showMessage = true) {
    if (showMessage && !window.location.pathname.endsWith('login.html')) {
        mostrarMensagemErro('Sua sessão expirou. Por favor, faça login novamente.');
    }
    localStorage.removeItem('authToken');
    localStorage.removeItem('user');
    
    if (!window.location.pathname.endsWith('login.html')) {
        window.location.href = 'login.html';
    }
}

// ==================== INICIALIZAÇÃO DA APLICAÇÃO ====================

// Verificar autenticação ao carregar a página
document.addEventListener('DOMContentLoaded', async () => {
    if (window.location.pathname.endsWith('login.html')) {
        return;
    }

    showLoading();
    
    try {
        const token = localStorage.getItem('authToken');
        const user = localStorage.getItem('user');
        
        if (!token || !user) {
            logout(false);
            return;
        }

        // Verifica se o token está válido
        if (isTokenExpired(token)) {
            const refreshed = await tryRefreshToken();
            if (!refreshed) {
                logout(false);
                return;
            }
        }
        
        // Inicializa a aplicação
        await init();
        
        // Configura o heartbeat para verificar autenticação
        setInterval(async () => {
            if (isTokenExpired(localStorage.getItem('authToken'))) {
                const refreshed = await tryRefreshToken();
                if (!refreshed) {
                    logout(false);
                }
            }
        }, 300000); // 5 minutos
        
    } catch (error) {
        console.error('Erro na inicialização:', error);
        logout(false);
    } finally {
        hideLoading();
    }
});

// Configuração de Event Listeners
function setupEventListeners() {
    elements.btnNovaFatura?.addEventListener('click', () => openModal());
    elements.spanClose?.addEventListener('click', () => closeModal());
    window.addEventListener('click', (e) => { 
        if (e.target === elements.modal) closeModal(); 
    });
    elements.filterStatus?.addEventListener('change', () => carregarFaturas());
    elements.form?.addEventListener('submit', handleSubmit);
    
    // Notificações
    document.addEventListener('click', (e) => {
        if (!elements.notificacoesContainer?.contains(e.target) && 
            e.target !== elements.notificacoesBadge) {
            elements.notificacoesContainer.style.display = 'none';
        }
    });
    
    elements.notificacoesBadge?.addEventListener('click', (e) => {
        e.stopPropagation();
        elements.notificacoesContainer.style.display = 
            elements.notificacoesContainer.style.display === 'block' ? 'none' : 'block';
    });
}

// Inicialização da aplicação
async function init() {
    setupEventListeners();
    
    try {
        // Carrega dados do usuário
        const user = JSON.parse(localStorage.getItem('user'));
        if (user?.username) {
            elements.usernameDisplay.textContent = user.username;
        }

        // Carrega dados iniciais
        await Promise.all([
            carregarOperadoras(),
            carregarFaturas(),
            verificarNotificacoes()
        ]);

        // Configura verificação periódica de notificações
        setInterval(verificarNotificacoes, 3600000); // 1 hora
        
    } catch (error) {
        console.error('Erro na inicialização:', error);
        mostrarMensagemErro('Erro ao carregar dados iniciais. Por favor, recarregue a página.');
    }
}

// ==================== FUNÇÕES DE INTERFACE ====================

function showLoading() {
    if (elements.loadingIndicator) {
        elements.loadingIndicator.style.display = 'block';
    }
}

function hideLoading() {
    if (elements.loadingIndicator) {
        elements.loadingIndicator.style.display = 'none';
    }
}

function openModal(fatura = null) {
    currentFaturaId = fatura?.id || null;
    elements.modalTitle.textContent = currentFaturaId ? 'Editar Fatura' : 'Nova Fatura';
    elements.form.reset();

    if (fatura) {
        elements.operadora.value = fatura.operadora_id;
        elements.referencia.value = fatura.referencia;
        elements.valor.value = fatura.valor;
        elements.vencimento.value = fatura.vencimento.split('T')[0];
        
        if (fatura.status === 'enviado') {
            elements.enviadoPara.value = fatura.enviado_para || '';
            elements.envioFields.style.display = 'block';
            elements.comprovante.disabled = true;
        } else {
            elements.envioFields.style.display = 'none';
            elements.comprovante.disabled = false;
        }
        
        elements.btnSubmit.textContent = 'Atualizar';
    } else {
        elements.envioFields.style.display = 'none';
        elements.btnSubmit.textContent = 'Salvar';
        elements.comprovante.disabled = false;
    }

    elements.modal.style.display = 'block';
}

function closeModal() {
    elements.modal.style.display = 'none';
    currentFaturaId = null;
}

// ==================== MANIPULAÇÃO DE FATURAS ====================

async function handleSubmit(e) {
    e.preventDefault();
    
    if (!elements.operadora.value || !elements.referencia.value || !elements.valor.value || !elements.vencimento.value) {
        mostrarMensagemErro('Por favor, preencha todos os campos obrigatórios.');
        return;
    }

    const fatura = {
        operadora_id: elements.operadora.value,
        referencia: elements.referencia.value,
        valor: parseFloat(elements.valor.value),
        vencimento: elements.vencimento.value
    };

    const enviado_para = elements.enviadoPara.value;
    const comprovante = elements.comprovante.files[0];

    try {
        elements.btnSubmit.disabled = true;
        elements.btnSubmit.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processando...';
        
        let id = currentFaturaId;
        const isEdit = !!currentFaturaId;

        const endpoint = `/api/faturas${isEdit ? `/${id}` : ''}`;
        const method = isEdit ? 'PUT' : 'POST';
        
        const result = await fetchAuth(endpoint, {
            method,
            body: JSON.stringify(fatura)
        });
        
        id = result.id || id;

        if (enviado_para && comprovante) {
            const formData = new FormData();
            formData.append('enviado_para', enviado_para);
            formData.append('comprovante', comprovante);

            await fetchAuth(`/api/faturas/${id}/enviar`, {
                method: 'PUT',
                body: formData
            });
        }

        closeModal();
        await carregarFaturas();
        await verificarNotificacoes();
        
        mostrarMensagemSucesso(isEdit ? 'Fatura atualizada com sucesso!' : 'Fatura criada com sucesso!');
        
    } catch (err) {
        console.error('Erro:', err);
        mostrarMensagemErro(`Erro: ${err.message}`);
    } finally {
        elements.btnSubmit.disabled = false;
        elements.btnSubmit.innerHTML = isEdit ? 'Atualizar' : 'Salvar';
    }
}

async function carregarOperadoras() {
    try {
        operadoras = await fetchAuth('/api/operadoras');
        
        elements.operadora.innerHTML = '<option value="">Selecione uma operadora</option>' + 
            operadoras.map(op => `<option value="${op.id}">${op.nome}</option>`).join('');
    } catch (err) {
        console.error('Erro ao carregar operadoras:', err);
        throw err;
    }
}

async function carregarFaturas() {
    try {
        showLoading();
        let url = '/api/faturas';
        const status = elements.filterStatus.value;

        if (status) {
            url += `?status=${status}`;
        }

        listaFaturas = await fetchAuth(url);
        renderizarFaturas(listaFaturas);
        atualizarContadores();
    } catch (err) {
        console.error('Erro ao carregar faturas:', err);
        mostrarMensagemErro('Erro ao carregar faturas. Por favor, tente novamente.');
        throw err;
    } finally {
        hideLoading();
    }
}

function renderizarFaturas(faturas) {
    if (!faturas.length) {
        elements.tbody.innerHTML = '<tr><td colspan="7" class="no-data">Nenhuma fatura encontrada</td></tr>';
        return;
    }

    elements.tbody.innerHTML = faturas.map(fatura => {
        const vencimentoDate = new Date(fatura.vencimento);
        const hoje = new Date();
        const diffTime = vencimentoDate - hoje;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        let statusText = '';
        let statusClass = '';
        
        if (fatura.status === 'enviado') {
            statusText = `✅ Enviado em ${new Date(fatura.data_envio).toLocaleDateString()}`;
            statusClass = 'enviado';
        } else if (diffDays < 0) {
            statusText = '⚠️ Vencida';
            statusClass = 'vencida';
        } else if (diffDays <= 7) {
            statusText = `⏳ Vence em ${diffDays} dia${diffDays !== 1 ? 's' : ''}`;
            statusClass = 'proximo';
        } else {
            statusText = '📌 Pendente';
            statusClass = 'pendente';
        }
        
        const operadora = operadoras.find(op => op.id === fatura.operadora_id) || {};
        
        return `
            <tr class="${statusClass}">
                <td>${operadora.nome || 'N/A'}</td>
                <td>${fatura.referencia}</td>
                <td>R$ ${parseFloat(fatura.valor).toFixed(2)}</td>
                <td>${new Date(fatura.vencimento).toLocaleDateString()}</td>
                <td class="status-cell">${statusText}</td>
                <td class="actions">
                    <button class="btn-edit" data-id="${fatura.id}" title="Editar">
                        <i class="fas fa-edit"></i>
                    </button>
                    ${fatura.status !== 'enviado' ? `
                        <button class="btn-enviar" data-id="${fatura.id}" title="Marcar como enviada">
                            <i class="fas fa-paper-plane"></i>
                        </button>
                    ` : ''}
                    <button class="btn-delete" data-id="${fatura.id}" title="Excluir">
                        <i class="fas fa-trash"></i>
                    </button>
                    ${fatura.comprovante_path ? `
                        <a href="${API_BASE}${fatura.comprovante_path}" target="_blank" class="btn-view" title="Ver comprovante">
                            <i class="fas fa-eye"></i>
                        </a>
                    ` : ''}
                </td>
            </tr>
        `;
    }).join('');

    setupTableEvents();
}

function setupTableEvents() {
    document.querySelectorAll('.btn-edit').forEach(btn => {
        btn.addEventListener('click', () => {
            const fatura = listaFaturas.find(f => f.id == btn.dataset.id);
            if (fatura) openModal(fatura);
        });
    });

    document.querySelectorAll('.btn-enviar').forEach(btn => {
        btn.addEventListener('click', () => {
            const fatura = listaFaturas.find(f => f.id == btn.dataset.id);
            if (fatura) {
                currentFaturaId = fatura.id;
                elements.modalTitle.textContent = 'Enviar Fatura';
                elements.operadora.value = fatura.operadora_id;
                elements.referencia.value = fatura.referencia;
                elements.valor.value = fatura.valor;
                elements.vencimento.value = fatura.vencimento.split('T')[0];
                elements.envioFields.style.display = 'block';
                elements.btnSubmit.textContent = 'Enviar';
                elements.modal.style.display = 'block';
            }
        });
    });

    document.querySelectorAll('.btn-delete').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (confirm('Tem certeza que deseja excluir esta fatura?')) {
                try {
                    await fetchAuth(`/api/faturas/${btn.dataset.id}`, {
                        method: 'DELETE'
                    });
                    
                    await carregarFaturas();
                    await verificarNotificacoes();
                    mostrarMensagemSucesso('Fatura excluída com sucesso!');
                } catch (err) {
                    console.error('Erro ao excluir fatura:', err);
                    mostrarMensagemErro(`Erro ao excluir fatura: ${err.message}`);
                }
            }
        });
    });
}

// ==================== FUNÇÕES AUXILIARES ====================

function atualizarContadores() {
    const [pendentes, proximas, vencidas] = listaFaturas.reduce((acc, fatura) => {
        if (fatura.status === 'enviado') return acc;
        
        const vencimento = new Date(fatura.vencimento);
        const hoje = new Date();
        const diffTime = vencimento - hoje;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffDays < 0) acc[2]++;
        else if (diffDays <= 7) acc[1]++;
        else acc[0]++;
        
        return acc;
    }, [0, 0, 0]);

    elements.countPending.textContent = pendentes;
    elements.countDueSoon.textContent = proximas;
    elements.countOverdue.textContent = vencidas;
}

async function verificarNotificacoes() {
    try {
        const notificacoes = await fetchAuth('/api/notificacoes');
        
        if (notificacoes.length > 0) {
            elements.notificacoesBadge.textContent = notificacoes.length;
            elements.notificacoesBadge.style.display = 'inline-block';
            
            elements.notificacoesList.innerHTML = notificacoes.map(not => {
                const vencimento = new Date(not.vencimento);
                const diffDays = Math.ceil((vencimento - new Date()) / (1000 * 60 * 60 * 24));
                
                return `
                    <li>
                        <strong>${not.operadora_nome}</strong> - ${not.referencia}
                        <br>
                        <small>Vence em ${diffDays} dia${diffDays !== 1 ? 's' : ''} (${vencimento.toLocaleDateString()})</small>
                    </li>
                `;
            }).join('');
            
            if (!localStorage.getItem('notificacoesVistas')) {
                mostrarMensagemErro(`Você tem ${notificacoes.length} fatura(s) próxima(s) do vencimento!`);
                localStorage.setItem('notificacoesVistas', 'true');
            }
        } else {
            elements.notificacoesBadge.style.display = 'none';
        }
    } catch (err) {
        console.error('Erro ao verificar notificações:', err);
    }
}

function mostrarMensagemErro(mensagem) {
    const toast = document.createElement('div');
    toast.className = 'toast-error';
    toast.textContent = mensagem;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.remove();
    }, 5000);
}

function mostrarMensagemSucesso(mensagem) {
    const toast = document.createElement('div');
    toast.className = 'toast-success';
    toast.textContent = mensagem;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.remove();
    }, 5000);
}

// Mostrar/ocultar menu admin conforme permissões
function verificarAdmin() {
    const user = JSON.parse(localStorage.getItem('user'));
    if (user && user.isAdmin) {
        document.getElementById('adminMenu').style.display = 'block';
    } else {
        document.getElementById('adminMenu').style.display = 'none';
    }
}

// Funções para abrir/fechar o modal
function abrirCadastroUsuario() {
    document.getElementById('modalCadastroUsuario').style.display = 'block';
}

function fecharModalCadastro() {
    document.getElementById('modalCadastroUsuario').style.display = 'none';
    document.getElementById('formCadastroUsuario').reset();
    document.getElementById('cadastroError').textContent = '';
}

// Função para abrir o gerenciamento de usuários
function abrirGerenciamentoUsuarios() {
    carregarUsuarios();
    document.getElementById('modalUsuarios').style.display = 'block';
}

function fecharModalUsuarios() {
    document.getElementById('modalUsuarios').style.display = 'none';
}

// Carregar lista de usuários
async function carregarUsuarios() {
    try {
        showLoading();
        const usuarios = await fetchAuth('/api/usuarios');
        usuariosCadastrados = usuarios;
        renderizarUsuarios(usuarios);
    } catch (error) {
        console.error('Erro ao carregar usuários:', error);
        mostrarMensagemErro('Erro ao carregar lista de usuários');
    } finally {
        hideLoading();
    }
}

// Renderizar tabela de usuários
function renderizarUsuarios(usuarios) {
    const tbody = document.querySelector('#tabelaUsuarios tbody');
    tbody.innerHTML = '';
    
    usuarios.forEach(usuario => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${usuario.id}</td>
            <td>${usuario.username}</td>
            <td>${usuario.is_admin ? 'Administrador' : 'Usuário'}</td>
            <td>
                <button onclick="excluirUsuario(${usuario.id})" class="btn-action delete" ${usuario.is_admin ? 'disabled' : ''}>
                    <i class="fas fa-trash"></i> Excluir
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Função para excluir usuário
async function excluirUsuario(id) {
    const user = JSON.parse(localStorage.getItem('user'));
    
    // Verifica se o usuário atual é admin
    if (!user || !user.isAdmin) {
        mostrarMensagemErro('Apenas administradores podem excluir usuários!');
        return;
    }
    
    // Verifica se está tentando excluir a si mesmo
    if (user.id === id) {
        mostrarMensagemErro('Você não pode excluir a si mesmo!');
        return;
    }
    
    if (!confirm('Tem certeza que deseja excluir este usuário?')) return;
    
    try {
        showLoading();
        await fetchAuth(`/api/usuarios/${id}`, { method: 'DELETE' });
        mostrarMensagemSucesso('Usuário excluído com sucesso!');
        await carregarUsuarios();
    } catch (error) {
        console.error('Erro ao excluir usuário:', error);
        mostrarMensagemErro(`Erro ao excluir usuário: ${error.message}`);
    } finally {
        hideLoading();
    }
}

// Chamar verificarAdmin quando a página carregar
document.addEventListener('DOMContentLoaded', () => {
    verificarAdmin();
    
    // Configurar submit do formulário de cadastro
    const formCadastro = document.getElementById('formCadastroUsuario');
    if (formCadastro) {
        formCadastro.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const username = document.getElementById('novoUsername').value;
            const password = document.getElementById('novaSenha').value;
            const isAdmin = document.getElementById('novoIsAdmin').checked;
            
            try {
                showLoading();
                await fetchAuth('/api/usuarios', {
                    method: 'POST',
                    body: JSON.stringify({ username, password, isAdmin })
                });
                
                mostrarMensagemSucesso('Usuário cadastrado com sucesso!');
                fecharModalCadastro();
                
            } catch (error) {
                console.error('Erro ao cadastrar usuário:', error);
                document.getElementById('cadastroError').textContent = error.message;
            } finally {
                hideLoading();
            }
        });
    }
    
    // Configurar botão de gerenciamento de usuários
    const btnGerenciarUsuarios = document.getElementById('btnGerenciarUsuarios');
    if (btnGerenciarUsuarios) {
        btnGerenciarUsuarios.addEventListener('click', abrirGerenciamentoUsuarios);
    }
    
    // Configurar botão de fechar modal de usuários
    const btnFecharModalUsuarios = document.querySelector('#modalUsuarios .close');
    if (btnFecharModalUsuarios) {
        btnFecharModalUsuarios.addEventListener('click', fecharModalUsuarios);
    }
});

// Atualize a função de excluir fatura para verificar admin
async function deleteFatura(id) {
    const user = JSON.parse(localStorage.getItem('user'));
    
    if (!user || !user.isAdmin) {
        mostrarMensagemErro('Apenas administradores podem excluir faturas!');
        return;
    }
    
    if (!confirm('Tem certeza que deseja excluir esta fatura?')) return;
    
    try {
        showLoading();
        await fetchAuth(`/api/faturas/${id}`, { method: 'DELETE' });
        await carregarFaturas();
        mostrarMensagemSucesso('Fatura excluída com sucesso!');
    } catch (error) {
        console.error('Erro ao excluir fatura:', error);
        mostrarMensagemErro(`Erro ao excluir fatura: ${error.message}`);
    } finally {
        hideLoading();
    }
}