const db = require('../db');

class Fatura {
  static async criar(faturaData) {
    const { numero, valor, data_vencimento, status } = faturaData;
    const query = `
      INSERT INTO faturas (numero, valor, data_vencimento, status)
      VALUES ($1, $2, $3, $4)
      RETURNING *`;
    const values = [numero, valor, data_vencimento, status];
    const { rows } = await db.query(query, values);
    return rows[0];
  }

  static async buscarPorId(id) {
    const { rows } = await db.query('SELECT * FROM faturas WHERE id = $1', [id]);
    return rows[0];
  }

  // Adicione outros métodos conforme necessário
}

module.exports = Fatura;