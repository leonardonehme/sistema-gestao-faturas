// Configuração da API base
const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:3001'
  : 'https://seu-app.onrender.com';

// Estado da aplicação
let currentFaturaId = null;
let listaFaturas = [];
let operadoras = [];
let usuariosCadastrados = [];
let isEdit = false;

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
    loadingIndicator: document.getElementById('loadingIndicator'),
    adminMenu: document.getElementById('adminMenu') // Adicionei esta linha
};

// ==================== FUNÇÕES DE AUTENTICAÇÃO ====================

function isTokenExpired(token) {
    if (!token) return true;
    try {
        const decoded = JSON.parse(atob(token.split('.')[1]));
        return decoded.exp < (Date.now() / 1000);
    } catch (e) {
        return true;
    }
}

async function fetchAuth(url, options = {}) {
    let token = localStorage.getItem('authToken');
    
    if (!token || isTokenExpired(token)) {
        try {
            const response = await fetch(`${API_BASE}/api/refresh-token`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                token = data.token;
                localStorage.setItem('authToken', token);
            } else {
                logout();
                throw new Error('Sessão expirada');
            }
        } catch (error) {
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
        
        if (response.status === 401) {
            logout();
            throw new Error('Não autorizado');
        }
        
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || 'Erro na requisição');
        }
        
        return await response.json();
    } catch (error) {
        console.error(`Erro na requisição para ${url}:`, error);
        throw error;
    }
}

function logout() {
    localStorage.removeItem('authToken');
    localStorage.removeItem('user');
    window.location.href = 'login.html';
}

// ==================== INICIALIZAÇÃO ====================

document.addEventListener('DOMContentLoaded', async () => {
    if (window.location.pathname.endsWith('login.html')) return;

    showLoading();
    
    try {
        const token = localStorage.getItem('authToken');
        if (!token) {
            logout();
            return;
        }

        const user = JSON.parse(localStorage.getItem('user'));
        if (user?.username) {
            elements.usernameDisplay.textContent = user.username;
        }

        await Promise.all([
            carregarOperadoras(),
            carregarFaturas(),
            verificarNotificacoes()
        ]);

        setupEventListeners();
        verificarAdmin();
        
    } catch (error) {
        console.error('Erro na inicialização:', error);
        mostrarMensagemErro('Erro ao carregar dados');
        logout();
    } finally {
        hideLoading();
    }
});

function setupEventListeners() {
    // Corrigindo o event listener do botão nova fatura
    if (elements.btnNovaFatura) {
        elements.btnNovaFatura.addEventListener('click', (e) => {
            e.preventDefault();
            openModal();
        });
    }

    elements.spanClose?.addEventListener('click', () => closeModal());
    window.addEventListener('click', (e) => { 
        if (e.target === elements.modal) closeModal(); 
    });
    elements.filterStatus?.addEventListener('change', () => carregarFaturas());
    elements.form?.addEventListener('submit', handleSubmit);
    
    // Notificações
    elements.notificacoesBadge?.addEventListener('click', (e) => {
        e.stopPropagation();
        elements.notificacoesContainer.style.display = 
            elements.notificacoesContainer.style.display === 'block' ? 'none' : 'block';
    });
    
    // Cadastro de usuário
    document.getElementById('formCadastroUsuario')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const username = document.getElementById('novoUsername').value.trim();
        const password = document.getElementById('novaSenha').value;
        const nome = document.getElementById('novoNome').value.trim() || '';
        const isAdmin = document.getElementById('novoIsAdmin').checked;
        const errorMsg = document.getElementById('cadastroError');

        if (!username || !password) {
            errorMsg.textContent = 'Usuário e senha são obrigatórios';
            return;
        }

        try {
            showLoading();
            const result = await fetchAuth('/api/usuarios', {
                method: 'POST',
                body: JSON.stringify({ 
                    username, 
                    password, 
                    nome,
                    isAdmin 
                })
            });
            
            mostrarMensagemSucesso(`Usuário ${result.username} cadastrado com sucesso!`);
            fecharModalCadastro();
            if (window.carregarUsuarios) await carregarUsuarios();
            
        } catch (error) {
            console.error('Erro ao cadastrar usuário:', error);
            errorMsg.textContent = error.message.includes('username') 
                ? 'Nome de usuário já existe' 
                : 'Erro ao cadastrar usuário';
        } finally {
            hideLoading();
        }
    });
}

// ==================== FUNÇÕES DE INTERFACE ====================

function showLoading() {
    if (elements.loadingIndicator) {
        elements.loadingIndicator.style.display = 'flex';
    }
}

function hideLoading() {
    if (elements.loadingIndicator) {
        elements.loadingIndicator.style.display = 'none';
    }
}

function openModal(fatura = null) {
    console.log('Abrindo modal...'); // Debug
    currentFaturaId = fatura?.id || null;
    isEdit = !!currentFaturaId;
    elements.modalTitle.textContent = isEdit ? 'Editar Fatura' : 'Nova Fatura';
    elements.form.reset();

    if (fatura) {
        elements.operadora.value = fatura.operadora_id;
        elements.referencia.value = fatura.referencia;
        elements.valor.value = fatura.valor;
        elements.vencimento.value = fatura.vencimento ? fatura.vencimento.split('T')[0] : '';
        
        if (fatura.status === 'enviado') {
            elements.enviadoPara.value = fatura.enviado_para || '';
            elements.envioFields.style.display = 'block';
        } else {
            elements.envioFields.style.display = 'none';
        }
        
        elements.btnSubmit.textContent = 'Atualizar';
    } else {
        elements.envioFields.style.display = 'none';
        elements.btnSubmit.textContent = 'Salvar';
    }

    elements.modal.style.display = 'block';
}

function closeModal() {
    elements.modal.style.display = 'none';
    currentFaturaId = null;
    isEdit = false;
}

// ==================== FATURAS ====================

async function handleSubmit(e) {
    e.preventDefault();
    
    // Validar e formatar a data
    const vencimentoValue = elements.vencimento.value;
    let vencimentoFormatado = '';
    
    try {
        // Converter para formato YYYY-MM-DD
        if (vencimentoValue) {
            const dateParts = vencimentoValue.split('/');
            if (dateParts.length === 3) {
                // Formato DD/MM/YYYY -> converter para YYYY-MM-DD
                vencimentoFormatado = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;
            } else {
                // Assumir que já está no formato YYYY-MM-DD
                vencimentoFormatado = vencimentoValue;
            }
            
            // Validar se é uma data válida
            if (isNaN(new Date(vencimentoFormatado).getTime())) {
                throw new Error('Data inválida');
            }
        }
    } catch (error) {
        mostrarMensagemErro('Formato de data inválido. Use DD/MM/AAAA');
        return;
    }

    const camposObrigatorios = {
        operadora: elements.operadora.value,
        referencia: elements.referencia.value,
        valor: elements.valor.value,
        vencimento: vencimentoFormatado
    };

    const camposFaltando = Object.entries(camposObrigatorios)
        .filter(([_, value]) => !value)
        .map(([name]) => name);

    if (camposFaltando.length > 0) {
        mostrarMensagemErro(`Preencha os campos obrigatórios: ${camposFaltando.join(', ')}`);
        return;
    }

    const dadosFatura = {
    operadora_id: parseInt(camposObrigatorios.operadora),
    referencia: camposObrigatorios.referencia,
    valor: parseFloat(camposObrigatorios.valor),
    data_vencimento: camposObrigatorios.vencimento, // Envia ambos os nomes por segurança
    vencimento: camposObrigatorios.vencimento
    };

    try {
        elements.btnSubmit.disabled = true;
        elements.btnSubmit.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...';

        console.log('Enviando dados:', dadosFatura); // Para debug

        const response = await fetchAuth(isEdit ? `/api/faturas/${currentFaturaId}` : '/api/faturas', {
            method: isEdit ? 'PUT' : 'POST',
            body: JSON.stringify(dadosFatura)
        });

        // Processar comprovante se existir
        if (elements.comprovante.files[0]) {
            const formData = new FormData();
            formData.append('comprovante', elements.comprovante.files[0]);
            formData.append('enviado_para', elements.enviadoPara.value || '');

            await fetchAuth(`/api/faturas/${response.id || currentFaturaId}/comprovante`, {
                method: 'POST',
                body: formData
            });
        }

        mostrarMensagemSucesso(isEdit ? 'Fatura atualizada!' : 'Fatura criada!');
        closeModal();
        await carregarFaturas();
        
    } catch (error) {
        console.error('Erro ao salvar fatura:', error);
        mostrarMensagemErro(error.message || 'Erro ao salvar fatura');
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
        const status = elements.filterStatus?.value;

        if (status) {
            url += `?status=${status}`;
        }

        listaFaturas = await fetchAuth(url);
        renderizarFaturas(listaFaturas);
        atualizarContadores();
    } catch (err) {
        console.error('Erro ao carregar faturas:', err);
        mostrarMensagemErro('Erro ao carregar faturas');
    } finally {
        hideLoading();
    }
}

function renderizarFaturas(faturas) {
    if (!Array.isArray(faturas) || faturas.length === 0) {
        elements.tbody.innerHTML = '<tr><td colspan="7" class="no-data">Nenhuma fatura encontrada</td></tr>';
        return;
    }

    elements.tbody.innerHTML = faturas.map(fatura => {
        const vencimentoDate = fatura.vencimento ? new Date(fatura.vencimento) : null;
        const hoje = new Date();
        const diffDays = vencimentoDate ? Math.ceil((vencimentoDate - hoje) / (86400000)) : 0;
        
        let statusText, statusClass;
        
        if (fatura.status === 'enviado') {
            statusText = '✅ Enviado';
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
                <td>
                    <input type="checkbox" class="enviado-checkbox" 
                           data-id="${fatura.id}" 
                           ${fatura.status === 'enviado' ? 'checked' : ''}
                           ${fatura.status === 'enviado' ? 'disabled' : ''}>
                </td>
                <td>${operadora.nome || 'N/A'}</td>
                <td>${fatura.referencia || ''}</td>
                <td>R$ ${Number(fatura.valor).toFixed(2)}</td>
                <td>${vencimentoDate?.toLocaleDateString() || ''}</td>
                <td class="status-cell">${statusText}</td>
                <td class="actions">
                    <button class="btn-edit" data-id="${fatura.id}"><i class="fas fa-edit"></i></button>
                    ${fatura.status !== 'enviado' ? `
                        <button class="btn-enviar" data-id="${fatura.id}"><i class="fas fa-paper-plane"></i></button>
                    ` : ''}
                    <button class="btn-delete" data-id="${fatura.id}"><i class="fas fa-trash"></i></button>
                    ${fatura.comprovante_path ? `
                        <a href="${API_BASE}${fatura.comprovante_path}" target="_blank" class="btn-view">
                            <i class="fas fa-eye"></i>
                        </a>
                    ` : ''}
                </td>
            </tr>
        `;
    }).join('');

    // Configurar eventos dos checkboxes
    document.querySelectorAll('.enviado-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', async (e) => {
            if (e.target.checked) {
                try {
                    showLoading();
                    await fetchAuth(`/api/faturas/${e.target.dataset.id}/enviar`, {
                        method: 'PUT',
                        body: JSON.stringify({
                            enviado_para: 'Marcado via interface'
                        })
                    });
                    await carregarFaturas();
                    mostrarMensagemSucesso('Fatura marcada como enviada!');
                } catch (error) {
                    console.error('Erro ao marcar fatura como enviada:', error);
                    mostrarMensagemErro('Erro ao marcar fatura como enviada');
                    e.target.checked = false;
                } finally {
                    hideLoading();
                }
            }
        });
    });

    // Configurar eventos dos botões (mantenha o restante do código existente)
    // ...

    // Configurar eventos dos botões
    document.querySelectorAll('.btn-edit').forEach(btn => {
        btn.addEventListener('click', () => {
            const fatura = listaFaturas.find(f => f.id == btn.dataset.id);
            if (fatura) openModal(fatura);
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
                    mostrarMensagemSucesso('Fatura excluída!');
                } catch (error) {
                    mostrarMensagemErro('Erro ao excluir fatura');
                }
            }
        });
    });
}

function atualizarContadores() {
    const [enviadas, pendentes, proximas, vencidas] = listaFaturas.reduce((acc, fatura) => {
        if (fatura.status === 'enviado') {
            acc[0]++;
            return acc;
        }
        
        const vencimento = fatura.vencimento ? new Date(fatura.vencimento) : null;
        const hoje = new Date();
        const diffDays = vencimento ? Math.ceil((vencimento - hoje) / (86400000)) : 0;
        
        if (diffDays < 0) acc[3]++;
        else if (diffDays <= 7) acc[2]++;
        else acc[1]++;
        
        return acc;
    }, [0, 0, 0, 0]);

    // Adicione um elemento no HTML para mostrar as enviadas
    const countSent = document.getElementById('countSent');
    if (countSent) countSent.textContent = enviadas;
    
    elements.countPending.textContent = pendentes;
    elements.countDueSoon.textContent = proximas;
    elements.countOverdue.textContent = vencidas;
}

// ==================== USUÁRIOS ====================

function abrirCadastroUsuario() {
    fecharModalUsuarios();
    const modal = document.getElementById('modalCadastroUsuario');
    if (modal) modal.style.display = 'block';
}

function fecharModalCadastro() {
    const modal = document.getElementById('modalCadastroUsuario');
    if (modal) modal.style.display = 'none';
    document.getElementById('formCadastroUsuario').reset();
    document.getElementById('cadastroError').textContent = '';
}

function abrirGerenciamentoUsuarios() {
    fecharModalCadastro();
    carregarUsuarios();
    const modal = document.getElementById('modalUsuarios');
    if (modal) modal.style.display = 'block';
}

function fecharModalUsuarios() {
    const modal = document.getElementById('modalUsuarios');
    if (modal) modal.style.display = 'none';
}

async function carregarUsuarios() {
    try {
        showLoading();
        usuariosCadastrados = await fetchAuth('/api/usuarios');
        renderizarUsuarios(usuariosCadastrados);
    } catch (error) {
        console.error('Erro ao carregar usuários:', error);
        mostrarMensagemErro('Erro ao carregar usuários');
    } finally {
        hideLoading();
    }
}

function renderizarUsuarios(usuarios) {
    const tbody = document.querySelector('#tabelaUsuarios tbody');
    if (!tbody) return;
    
    tbody.innerHTML = usuarios.map(usuario => `
        <tr>
            <td>${usuario.id}</td>
            <td>${usuario.username}</td>
            <td>${usuario.is_admin ? 'Administrador' : 'Usuário'}</td>
            <td>
                <button onclick="excluirUsuario(${usuario.id})" class="btn-action delete" ${usuario.is_admin ? 'disabled' : ''}>
                    <i class="fas fa-trash"></i> Excluir
                </button>
            </td>
        </tr>
    `).join('');
}

async function excluirUsuario(id) {
    const user = JSON.parse(localStorage.getItem('user'));
    
    if (!user?.isAdmin) {
        mostrarMensagemErro('Apenas administradores podem excluir usuários');
        return;
    }
    
    if (user.id === id) {
        mostrarMensagemErro('Você não pode excluir a si mesmo');
        return;
    }
    
    if (!confirm('Tem certeza que deseja excluir este usuário?')) return;
    
    try {
        showLoading();
        await fetchAuth(`/api/usuarios/${id}`, { method: 'DELETE' });
        mostrarMensagemSucesso('Usuário excluído!');
        await carregarUsuarios();
    } catch (error) {
        console.error('Erro ao excluir usuário:', error);
        mostrarMensagemErro('Erro ao excluir usuário');
    } finally {
        hideLoading();
    }
}

function verificarAdmin() {
    const user = JSON.parse(localStorage.getItem('user'));
    if (elements.adminMenu) {
        elements.adminMenu.style.display = user?.isAdmin ? 'block' : 'none';
        console.log('Menu admin visível:', elements.adminMenu.style.display); // Debug
    }
}

// ==================== NOTIFICAÇÕES ====================

async function verificarNotificacoes() {
    try {
        const notificacoes = await fetchAuth('/api/notificacoes');
        
        if (notificacoes?.length > 0) {
            elements.notificacoesBadge.textContent = notificacoes.length;
            elements.notificacoesBadge.style.display = 'inline-block';
            
            elements.notificacoesList.innerHTML = notificacoes.map(not => {
                const vencimento = not.vencimento ? new Date(not.vencimento) : null;
                const diffDays = vencimento ? Math.ceil((vencimento - new Date()) / (86400000)) : 0;
                
                return `
                    <li>
                        <strong>${not.operadora_nome || 'N/A'}</strong> - ${not.referencia || ''}
                        <br>
                        <small>${vencimento ? `Vence em ${diffDays} dia${diffDays !== 1 ? 's' : ''}` : 'Sem vencimento'}</small>
                    </li>
                `;
            }).join('');
        } else {
            elements.notificacoesBadge.style.display = 'none';
        }
    } catch (err) {
        console.error('Erro ao verificar notificações:', err);
    }
}

// ==================== UTILITÁRIOS ====================

function mostrarMensagemErro(mensagem) {
    const toast = document.createElement('div');
    toast.className = 'toast-error';
    toast.textContent = mensagem;
    document.body.appendChild(toast);
    
    setTimeout(() => toast.remove(), 5000);
}

function mostrarMensagemSucesso(mensagem) {
    const toast = document.createElement('div');
    toast.className = 'toast-success';
    toast.textContent = mensagem;
    document.body.appendChild(toast);
    
    setTimeout(() => toast.remove(), 5000);
}