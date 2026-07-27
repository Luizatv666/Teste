const state = {
  movements: [],
  lastContent: '',
  quotes: new Map(),
  isLoading: false,
};

const FILE_VERSIONS = {
  'index.html': '2026.07.27.3',
  'styles.css': '2026.07.27.3',
  'app.js': '2026.07.27.3',
  'Movimentacoes.csv': '2026.07.27.3',
};

const QUOTES_URL =
  'https://docs.google.com/spreadsheets/d/16W7sG6d_QUrYneuxVdh39DDwoTInAQi0qCuAaEMBShA/export?format=csv';

const MOVEMENTS_URL = './Movimentacoes.csv';

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

function splitDelimitedLine(line, delimiter) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values;
}

function parseCsv(text) {
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .filter((line) => line.trim());

  if (lines.length < 2) return [];

  const hasTab = lines.some((line) => line.includes('\t'));
  const delimiter = hasTab ? '\t' : ',';
  const headers = splitDelimitedLine(lines[0], delimiter).map((header) => header.trim());

  return lines.slice(1).map((line) => {
    const values = splitDelimitedLine(line, delimiter);
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

function renderFileVersions() {
  const container = document.querySelector('#versionList');
  if (!container) return;

  container.innerHTML = Object.entries(FILE_VERSIONS)
    .map(
      ([fileName, version]) => `
        <div class="version-item">
          <span>${fileName}</span>
          <strong>${version}</strong>
        </div>
      `,
    )
    .join('');
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

function parseQuotes(text) {
  const quotes = new Map();
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .filter((line) => line.trim());

  if (lines.length < 2) return quotes;

  lines.slice(1).forEach((line) => {
    const values = splitDelimitedLine(line, ',');
    const symbol = String(values[0] || '').trim().toUpperCase();
    if (!symbol) return;

    const quote = parseCurrency(values[1]);
    if (quote) {
      quotes.set(symbol, quote);
    }
  });

  return quotes;
}

async function loadQuotes() {
  try {
    const response = await fetch(`${QUOTES_URL}&ts=${Date.now()}`, {
      cache: 'no-store',
    });

    if (!response.ok) return;

    const text = await response.text();
    if (!text || text.includes('<!DOCTYPE') || text.includes('<html')) return;

    state.quotes = parseQuotes(text);
  } catch (error) {
    // mantém as últimas cotações carregadas em caso de falha
  }
}

function renderSummaryByAsset(rows) {
  const summary = new Map();

  rows.forEach((row) => {
    const ativo = getRowValue(row, 'Ativo');
    const movimentacao = String(
      getRowValue(row, 'Movimentação') || getRowValue(row, 'Movimentaçao') || getRowValue(row, 'Movimentacao') || '',
    ).trim().toLowerCase();
    const quantidade = Number(getRowValue(row, 'Quantidade')) || 0;

    if (!ativo) return;

    if (!summary.has(ativo)) {
      summary.set(ativo, 0);
    }

    const tiposPermitidos = ['compra', 'desdobramento', 'bonificação'];
    if (tiposPermitidos.includes(movimentacao)) {
      summary.set(ativo, summary.get(ativo) + quantidade);
    }
  });

  const tbody = document.querySelector('#summaryBody');
  const entries = Array.from(summary.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  if (!entries.length) {
    tbody.innerHTML = '<tr><td colspan="4">Nenhum resumo disponível.</td></tr>';
    return;
  }

  tbody.innerHTML = entries
    .map(([ativo, quantidade]) => {
      const quote = state.quotes.get(String(ativo).trim().toUpperCase());
      const formattedQuote = quote != null ? formatCurrency(quote) : 'Sem cotação';
      const formattedValue = quote != null ? formatCurrency(quote * quantidade) : 'Sem cotação';

      return `
        <tr>
          <td>${ativo}</td>
          <td>${quantidade}</td>
          <td>${formattedQuote}</td>
          <td>${formattedValue}</td>
        </tr>
      `;
    })
    .join('');
}

function switchView(view) {
  const movementsTable = document.querySelector('#movementsTable');
  const summaryTable = document.querySelector('#summaryTable');
  const buttons = document.querySelectorAll('.view-btn');

  buttons.forEach((button) => {
    button.classList.toggle('active', button.dataset.view === view);
  });

  if (view === 'summary') {
    movementsTable.hidden = true;
    summaryTable.hidden = false;
  } else {
    movementsTable.hidden = false;
    summaryTable.hidden = true;
  }
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
  if (state.isLoading) return;
  state.isLoading = true;

  try {
    await loadQuotes();

    const response = await fetch(`${MOVEMENTS_URL}?ts=${Date.now()}`, {
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`Falha ao buscar ${MOVEMENTS_URL}: ${response.status}`);
    }

    const text = await response.text();

    if (!text || text.includes('<!DOCTYPE') || text.includes('<html')) {
      throw new Error('Conteúdo inválido recebido para as movimentações.');
    }

    const movements = parseCsv(text);
    state.movements = movements;
    state.lastContent = text;
    renderSummary(movements);
    renderTable(movements);
    renderSummaryByAsset(movements);
    setLastUpdated();
  } catch (error) {
    const tbody = document.querySelector('#movementsBody');
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5">${getErrorMessage(error)}</td>
        </tr>
      `;
    }
  } finally {
    state.isLoading = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.view-btn').forEach((button) => {
    button.addEventListener('click', () => switchView(button.dataset.view));
  });

  renderFileVersions();
  switchView('movements');
  loadMovements();
  setInterval(loadMovements, 1000);
});
