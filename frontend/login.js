const API_BASE_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:3001'
  : '';
        
        document.getElementById('loginForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const button = document.getElementById('loginButton');
            const originalText = button.textContent;
            button.disabled = true;
            button.textContent = 'Autenticando...';
            
            const username = document.getElementById('username').value.trim();
            const password = document.getElementById('password').value.trim();
            const errorElement = document.getElementById('errorMessage');
            errorElement.textContent = '';

            try {
                const response = await fetch(`${API_BASE_URL}/api/login`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ username, password })
                });

                if (!response.ok) {
                    const error = await response.json().catch(() => ({}));
                    throw new Error(error.error || 'Credenciais inválidas');
                }

                const { token, user } = await response.json();
                
                localStorage.setItem('authToken', token);
                localStorage.setItem('user', JSON.stringify(user));
                
                window.location.href = 'index.html';
                
            } catch (error) {
                console.error('Erro no login:', error);
                errorElement.textContent = error.message;
                button.disabled = false;
                button.textContent = originalText;
            }
        });

        // Verificar se já está logado
        document.addEventListener('DOMContentLoaded', () => {
            const token = localStorage.getItem('authToken');
            if (token) {
                window.location.href = 'index.html';
            }
        });