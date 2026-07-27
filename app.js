const state = {
  movements: [],
  lastContent: '',
};

const SHEET_URLS = [
  'https://docs.google.com/spreadsheets/d/16W7sG6d_QUrYneuxVdh39DDwoTInAQi0qCuAaEMBShA/export?format=csv&gid=1908759892',
  'https://docs.google.com/spreadsheets/d/16W7sG6d_QUrYneuxVdh39DDwoTInAQi0qCuAaEMBShA/export?format=csv',
  'https://docs.google.com/spreadsheets/d/16W7sG6d_QUrYneuxVdh39DDwoTInAQi0qCuAaEMBShA/gviz/tq?tqx=out:csv&gid=1908759892',
];

const FALLBACK_URL = './Movimentacoes.csv';

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

function getQuote(symbol) {
  const normalizedSymbol = String(symbol || '').trim().toUpperCase();
  if (!normalizedSymbol) return Promise.resolve(null);

  const query = normalizedSymbol.replace(/\.SA$/, '').replace(/[^A-Z0-9]/g, '');
  const candidates = [query, `${query}.SA`, `BVMF:${query}`, `${query}:BVMF`];

  return new Promise((resolve) => {
    let finished = false;
    const timeoutId = setTimeout(() => {
      if (!finished) {
        finished = true;
        resolve(null);
      }
    }, 5000);

    Promise.all(
      candidates.map((candidate) => {
        const formula = `=GOOGLEFINANCE("${candidate}";"price")`;
        return fetch(`https://script.google.com/macros/s/AKfycbw5Xx8b4bI6yU0cJkQJ3mNtmVZ-PxX4Y8M0YQx2tEjL3nD4N1g7mQ7gD2M4U1/exec?formula=${encodeURIComponent(formula)}`)
          .then((response) => {
            if (!response.ok) return null;
            return response.text();
          })
          .then((text) => {
            const cleaned = String(text || '').trim();
            const number = Number(cleaned.replace(',', '.').replace(/[^0-9.-]/g, ''));
            return Number.isFinite(number) ? number : null;
          })
          .catch(() => null);
      }),
    )
      .then((values) => {
        const quote = values.find((value) => value != null) ?? null;
        if (!finished) {
          finished = true;
          clearTimeout(timeoutId);
          resolve(quote);
        }
      })
      .catch(() => {
        if (!finished) {
          finished = true;
          clearTimeout(timeoutId);
          resolve(null);
        }
      });
  });
}

async function renderSummaryByAsset(rows) {
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

  const rowsHtml = await Promise.all(
    entries.map(async ([ativo, quantidade]) => {
      const quote = await getQuote(ativo);
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
    }),
  );

  tbody.innerHTML = rowsHtml.join('');
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
  const sources = [...SHEET_URLS, FALLBACK_URL];

  for (const source of sources) {
    try {
      const response = await fetch(`${source}?ts=${Date.now()}`, {
        cache: 'no-store',
      });

      if (!response.ok) {
        continue;
      }

      const text = await response.text();

      if (!text || text.includes('<!DOCTYPE') || text.includes('<html')) {
        continue;
      }

      if (text === state.lastContent) {
        return;
      }

      state.lastContent = text;
      const movements = parseCsv(text);
      state.movements = movements;
      renderSummary(movements);
      renderTable(movements);
      renderSummaryByAsset(movements);
      setLastUpdated();
      return;
    } catch (error) {
      continue;
    }
  }

  document.querySelector('#movementsBody').innerHTML = `
    <tr>
      <td colspan="5">Não foi possível carregar os dados da planilha. Verifique se a planilha está compartilhada publicamente para visualização.</td>
    </tr>
  `;
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.view-btn').forEach((button) => {
    button.addEventListener('click', () => switchView(button.dataset.view));
  });

  switchView('movements');
  loadMovements();
  setInterval(loadMovements, 1000);
});
