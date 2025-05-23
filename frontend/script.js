document.addEventListener('DOMContentLoaded', () => {
  // Configuração da API base
  const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3001'
    : 'https://seu-app.onrender.com';

  // Estado da aplicação
  let currentFaturaId = null;
  let listaFaturas = [];
  let operadoras = [];

  // Elementos da DOM
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
    notificacoesBadge: document.getElementById('notificacoesBadge')
  };

  // Event Listeners
  elements.btnNovaFatura.addEventListener('click', () => openModal());
  elements.spanClose.addEventListener('click', () => closeModal());
  window.addEventListener('click', (e) => { if (e.target === elements.modal) closeModal(); });
  elements.filterStatus.addEventListener('change', () => carregarFaturas());
  elements.form.addEventListener('submit', handleSubmit);

  // Inicialização
  init();

  async function init() {
    try {
      await carregarOperadoras();
      await carregarFaturas();
      await verificarNotificacoes();
      
      // Verificar notificações a cada hora
      setInterval(verificarNotificacoes, 3600000);
    } catch (error) {
      console.error('Erro na inicialização:', error);
      alert('Erro ao carregar dados iniciais. Por favor, recarregue a página.');
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

  async function handleSubmit(e) {
    e.preventDefault();
    
    // Validação básica
    if (!elements.operadora.value || !elements.referencia.value || !elements.valor.value || !elements.vencimento.value) {
      alert('Por favor, preencha todos os campos obrigatórios.');
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
      let id = currentFaturaId;
      const isEdit = !!currentFaturaId;

      // Criar ou atualizar fatura
      const endpoint = isEdit 
        ? `${API_BASE}/api/faturas/${id}`
        : `${API_BASE}/api/faturas`;
      
      const method = isEdit ? 'PUT' : 'POST';
      
      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fatura)
      });
      
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(errorText || 'Erro ao salvar fatura');
      }
      
      const result = await res.json();
      id = result.id || id;

      // Se houver envio de comprovante
      if (enviado_para && comprovante) {
        const formData = new FormData();
        formData.append('enviado_para', enviado_para);
        formData.append('comprovante', comprovante);

        const envioRes = await fetch(`${API_BASE}/api/faturas/${id}/enviar`, {
          method: 'PUT',
          body: formData
        });
        
        if (!envioRes.ok) {
          const errorText = await envioRes.text();
          throw new Error(errorText || 'Erro ao enviar comprovante');
        }
      }

      closeModal();
      await carregarFaturas();
      await verificarNotificacoes();
      
      alert(isEdit ? 'Fatura atualizada com sucesso!' : 'Fatura criada com sucesso!');
    } catch (err) {
      console.error('Erro:', err);
      alert(`Erro: ${err.message}`);
    }
  }

  async function carregarOperadoras() {
    try {
      const res = await fetch(`${API_BASE}/api/operadoras`);
      
      if (!res.ok) {
        throw new Error('Erro ao carregar operadoras');
      }
      
      operadoras = await res.json();
      
      elements.operadora.innerHTML = operadoras.map(op => 
        `<option value="${op.id}">${op.nome}</option>`
      ).join('');
    } catch (err) {
      console.error('Erro ao carregar operadoras:', err);
      throw err;
    }
  }

  async function carregarFaturas() {
    try {
      let url = `${API_BASE}/api/faturas`;
      const status = elements.filterStatus.value;

      if (status) {
        url += `?status=${status}`;
      }

      const res = await fetch(url);
      
      if (!res.ok) {
        throw new Error('Erro ao carregar faturas');
      }
      
      listaFaturas = await res.json();
      renderizarFaturas(listaFaturas);
      atualizarContadores();
    } catch (err) {
      console.error('Erro ao carregar faturas:', err);
      alert('Erro ao carregar faturas. Por favor, tente novamente.');
    }
  }

  function renderizarFaturas(faturas) {
    if (faturas.length === 0) {
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

    // Configurar eventos dos botões
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
            const res = await fetch(`${API_BASE}/api/faturas/${btn.dataset.id}`, {
              method: 'DELETE'
            });
            
            if (!res.ok) {
              throw new Error(await res.text());
            }
            
            await carregarFaturas();
            await verificarNotificacoes();
            alert('Fatura excluída com sucesso!');
          } catch (err) {
            console.error('Erro ao excluir fatura:', err);
            alert(`Erro ao excluir fatura: ${err.message}`);
          }
        }
      });
    });
  }

  function atualizarContadores() {
    const pendentes = listaFaturas.filter(f => {
      if (f.status === 'enviado') return false;
      const vencimento = new Date(f.vencimento);
      const hoje = new Date();
      return vencimento >= hoje;
    }).length;

    const proximas = listaFaturas.filter(f => {
      if (f.status === 'enviado') return false;
      const vencimento = new Date(f.vencimento);
      const hoje = new Date();
      const diffTime = vencimento - hoje;
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      return diffDays <= 7 && diffDays >= 0;
    }).length;

    const vencidas = listaFaturas.filter(f => {
      if (f.status === 'enviado') return false;
      const vencimento = new Date(f.vencimento);
      const hoje = new Date();
      return vencimento < hoje;
    }).length;

    elements.countPending.textContent = pendentes;
    elements.countDueSoon.textContent = proximas;
    elements.countOverdue.textContent = vencidas;
  }

  async function verificarNotificacoes() {
    try {
      const res = await fetch(`${API_BASE}/api/notificacoes`);
      
      if (!res.ok) {
        throw new Error('Erro ao verificar notificações');
      }
      
      const notificacoes = await res.json();
      
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
        
        elements.notificacoesContainer.style.display = 'block';
        
        // Mostrar alerta se for a primeira verificação
        if (!localStorage.getItem('notificacoesVistas')) {
          alert(`Você tem ${notificacoes.length} fatura(s) próxima(s) do vencimento!`);
          localStorage.setItem('notificacoesVistas', 'true');
        }
      } else {
        elements.notificacoesBadge.style.display = 'none';
        elements.notificacoesContainer.style.display = 'none';
      }
    } catch (err) {
      console.error('Erro ao verificar notificações:', err);
    }
  }

  // Fechar notificações quando clicar fora
  document.addEventListener('click', (e) => {
    if (!elements.notificacoesContainer.contains(e.target) && 
        e.target !== elements.notificacoesBadge) {
      elements.notificacoesContainer.style.display = 'none';
    }
  });

  // Mostrar/ocultar notificações
  elements.notificacoesBadge.addEventListener('click', (e) => {
    e.stopPropagation();
    elements.notificacoesContainer.style.display = 
      elements.notificacoesContainer.style.display === 'block' ? 'none' : 'block';
  });
});