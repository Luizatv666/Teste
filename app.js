const state = {
  movements: [],
  lastContent: '',
};

function parseCurrency(value) {
  if (!value) return 0;
  const normalized = String(value)
    .replace(/[R$\s]/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  return Number(normalized) || 0;
}

function normalizeHeader(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

function parseCsv(text) {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);

  if (lines.length < 2) return [];

  const headers = lines[0]
    .split('\t')
    .map((header) => header.trim());

  return lines.slice(1).map((line) => {
    const values = line.split('\t');
    const entry = {};

    headers.forEach((header, index) => {
      const normalizedHeader = normalizeHeader(header);
      entry[header] = values[index]?.trim() || '';
      entry[normalizedHeader] = values[index]?.trim() || '';
    });

    return entry;
  });
}

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

function getRowValue(row, key) {
  const direct = row[key];
  if (direct !== undefined) return direct;

  const normalized = normalizeHeader(key);
  return row[normalized] || '';
}

function renderSummary(rows) {
  const totalInvestido = rows.reduce(
    (sum, row) => sum + parseCurrency(getRowValue(row, 'Preço Total (R$)')),
    0,
  );

  const quantidadeAtivos = rows.length;
  const ativosUnicos = new Set(rows.map((row) => getRowValue(row, 'Ativo'))).size;

  document.querySelector('#totalInvestido').textContent = formatCurrency(totalInvestido);
  document.querySelector('#quantidadeAtivos').textContent = quantidadeAtivos;
  document.querySelector('#ativosUnicos').textContent = ativosUnicos;
}

function renderTable(rows) {
  const tbody = document.querySelector('#movementsBody');

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="5">Nenhuma movimentação encontrada.</td></tr>';
    return;
  }

  tbody.innerHTML = rows
    .map(
      (row) => `
        <tr>
          <td>${getRowValue(row, 'Ativo')}</td>
          <td>${getRowValue(row, 'Movimentação') || getRowValue(row, 'Movimentaçao') || getRowValue(row, 'Movimentacao') || ''}</td>
          <td>${getRowValue(row, 'Data')}</td>
          <td>${getRowValue(row, 'Quantidade')}</td>
          <td>${formatCurrency(parseCurrency(getRowValue(row, 'Preço Total (R$)')))}</td>
        </tr>
      `,
    )
    .join('');
}

function setLastUpdated() {
  const now = new Date();
  document.querySelector('#lastUpdated').textContent = `Atualizado às ${now.toLocaleTimeString('pt-BR')}`;
}

function getErrorMessage(error) {
  if (location.protocol === 'file:') {
    return 'Não foi possível carregar o arquivo localmente. Abra a página por meio de um servidor local, como http://localhost:8000, ou use uma extensão de servidor no VS Code.';
  }

  return error.message || 'Não foi possível carregar o arquivo de movimentações.';
}

async function loadMovements() {
  try {
    const response = await fetch(`./Movimentacoes.csv?ts=${Date.now()}`, {
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error('Não foi possível carregar o arquivo de movimentações.');
    }

    const text = await response.text();

    if (text === state.lastContent) {
      return;
    }

    state.lastContent = text;
    const movements = parseCsv(text);
    state.movements = movements;
    renderSummary(movements);
    renderTable(movements);
    setLastUpdated();
  } catch (error) {
    document.querySelector('#movementsBody').innerHTML = `
      <tr>
        <td colspan="5">${getErrorMessage(error)}</td>
      </tr>
    `;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadMovements();
  setInterval(loadMovements, 3000);
});
