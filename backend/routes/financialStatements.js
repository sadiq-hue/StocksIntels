const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const STOCKS_UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'stocks');
if (!fs.existsSync(STOCKS_UPLOAD_DIR)) {
  fs.mkdirSync(STOCKS_UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, STOCKS_UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `stmt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf' || path.extname(file.originalname).toLowerCase() === '.pdf') {
      return cb(null, true);
    }
    cb(new Error('Only PDF files are allowed'));
  },
});

// ── NSE Stocks ──

router.get('/nse-stocks', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    const search = (req.query.search || '').trim();
    const offset = (page - 1) * limit;
    let whereClause = "WHERE market = 'NSE'";
    const params = [];
    let idx = 1;
    if (search) {
      whereClause += ` AND (ticker ILIKE $${idx} OR name ILIKE $${idx} OR sector ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }
    const countResult = await pool.query(`SELECT COUNT(*)::int as cnt FROM stocks ${whereClause}`, params);
    const dataResult = await pool.query(
      `SELECT s.*, sf.pe_ratio, sf.pb_ratio, sf.market_cap, sf.dividend_yield
       FROM stocks s LEFT JOIN stock_fundamentals sf ON sf.symbol = s.ticker
       ${whereClause} ORDER BY s.ticker ASC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );
    res.json({ stocks: dataResult.rows, total: countResult.rows[0].cnt, page, limit });
  } catch (err) {
    console.error('NSE stocks error:', err.message);
    res.status(500).json({ error: 'Failed to fetch NSE stocks' });
  }
});

router.post('/nse-stocks', async (req, res) => {
  try {
    const { ticker, name, sector, currency } = req.body;
    if (!ticker || !name) return res.status(400).json({ error: 'Ticker and name are required' });
    const result = await pool.query(
      `INSERT INTO stocks (ticker, name, sector, market, currency, is_active)
       VALUES ($1, $2, $3, 'NSE', $4, true)
       ON CONFLICT (ticker) DO UPDATE SET name = EXCLUDED.name, sector = EXCLUDED.sector, is_active = true
       RETURNING *`,
      [ticker.toUpperCase(), name, sector || 'Other', currency || 'KES']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create NSE stock error:', err.message);
    res.status(500).json({ error: 'Failed to create stock' });
  }
});

router.put('/nse-stocks/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { ticker, name, sector, currency, is_active } = req.body;
    const fields = [];
    const params = [];
    let idx = 1;
    if (ticker !== undefined) { fields.push(`ticker = $${idx++}`); params.push(ticker); }
    if (name !== undefined) { fields.push(`name = $${idx++}`); params.push(name); }
    if (sector !== undefined) { fields.push(`sector = $${idx++}`); params.push(sector); }
    if (currency !== undefined) { fields.push(`currency = $${idx++}`); params.push(currency); }
    if (is_active !== undefined) { fields.push(`is_active = $${idx++}`); params.push(is_active); }
    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
    params.push(id);
    const result = await pool.query(
      `UPDATE stocks SET ${fields.join(', ')} WHERE id = $${idx} AND market = 'NSE' RETURNING *`,
      params
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Stock not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update NSE stock error:', err.message);
    res.status(500).json({ error: 'Failed to update stock' });
  }
});

router.delete('/nse-stocks/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM stocks WHERE id = $1 AND market = $2 RETURNING id', [id, 'NSE']);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Stock not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete NSE stock error:', err.message);
    res.status(500).json({ error: 'Failed to delete stock' });
  }
});

// ── Financial Statements ──

router.get('/financial-statements', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const status = req.query.status || null;
    const offset = (page - 1) * limit;
    let whereClause = 'WHERE 1=1';
    const params = [];
    let idx = 1;
    if (status) { whereClause += ` AND fs.status = $${idx++}`; params.push(status); }

    // stock_id may be INTEGER or UUID depending on schema; check column type
    const stockIdRaw = req.query.stock_id;
    if (stockIdRaw) {
      const typeRes = await pool.query(
        `SELECT data_type FROM information_schema.columns WHERE table_name = 'financial_statements' AND column_name = 'stock_id'`
      );
      if (typeRes.rows.length > 0 && typeRes.rows[0].data_type === 'uuid') {
        whereClause += ` AND fs.stock_id = $${idx++}::uuid`;
        params.push(stockIdRaw);
      } else {
        const sid = parseInt(stockIdRaw);
        if (!isNaN(sid)) { whereClause += ` AND fs.stock_id = $${idx++}`; params.push(sid); }
      }
    }

    const countResult = await pool.query(
      `SELECT COUNT(*)::int as cnt FROM financial_statements fs ${whereClause}`, params
    );
    let statements = [];
    try {
      const dataResult = await pool.query(
        `SELECT fs.*, s.ticker, s.name as stock_name
         FROM financial_statements fs
         JOIN stocks s ON s.id = fs.stock_id
         ${whereClause}
         ORDER BY fs.uploaded_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset]
      );
      statements = dataResult.rows;
    } catch {
      // JOIN may fail if schema mismatched; return statements without join data
      const dataResult = await pool.query(
        `SELECT fs.* FROM financial_statements fs ${whereClause}
         ORDER BY fs.uploaded_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset]
      );
      statements = dataResult.rows;
    }
    res.json({ statements, total: countResult.rows[0].cnt, page, limit });
  } catch (err) {
    console.error('Financial statements error:', err.message);
    // If table/schema issue, return empty
    if (err.message && (
      err.message.includes('does not exist') ||
      err.message.includes('invalid input syntax for type uuid') ||
      err.message.includes('uuid')
    )) {
      return res.json({ statements: [], total: 0, page: 1, limit: 50 });
    }
    res.status(500).json({ error: err.message || 'Failed to fetch financial statements' });
  }
});

router.post('/financial-statements/upload', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      if (err instanceof multer.MulterError) return res.status(400).json({ error: err.message });
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }
    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    try {
      const { stock_id, period_type, period_end_date } = req.body;
      if (!stock_id) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'stock_id is required' });
      }
      const stockResult = await pool.query('SELECT id FROM stocks WHERE id = $1', [stock_id]);
      if (stockResult.rows.length === 0) {
        fs.unlinkSync(req.file.path);
        return res.status(404).json({ error: 'Stock not found' });
      }
      const fileBuffer = fs.readFileSync(req.file.path);
      // Resolve stock_id: if financial_statements.stock_id is UUID, look up the stock's UUID from DB
      let sidVal = stock_id;
      try {
        const sidType = await pool.query(
          `SELECT data_type FROM information_schema.columns WHERE table_name = 'financial_statements' AND column_name = 'stock_id'`
        );
        if (sidType.rows.length > 0 && sidType.rows[0].data_type === 'uuid') {
          // Check if stocks.id is also UUID
          const stIdType = await pool.query(
            `SELECT data_type FROM information_schema.columns WHERE table_name = 'stocks' AND column_name = 'id'`
          );
          if (stIdType.rows.length > 0 && stIdType.rows[0].data_type === 'uuid') {
            const uuidResult = await pool.query('SELECT id::text FROM stocks WHERE id = $1::uuid', [stock_id]);
            if (uuidResult.rows.length > 0) sidVal = uuidResult.rows[0].id;
            else { /* fallback: use raw text */ }
          } else {
            // stocks.id is integer but financial_statements.stock_id is UUID — schema mismatch.
            // Try to find a matching stock by ticker
            const stockRow = await pool.query('SELECT ticker FROM stocks WHERE id = $1', [stock_id]);
            if (stockRow.rows.length > 0) {
              // Generate a deterministic UUID from the ticker or use the integer as text
              sidVal = stock_id; // PostgreSQL may still reject this, but we'll catch it below
            }
          }
        }
      } catch {}

      // Build INSERT with retry: drop columns that don't exist, handle type mismatches
      async function tryInsert(cols, vals) {
        const ph = cols.map((_, i) => '$' + (i + 1)).join(', ');
        return pool.query(`INSERT INTO financial_statements (${cols.join(', ')}) VALUES (${ph}) RETURNING id`, vals);
      }
      const allCols = ['stock_id', 'period_type', 'file_name', 'file_data', 'mime_type', 'status'];
      const allVals = [sidVal, period_type || 'annual', req.file.originalname, fileBuffer, req.file.mimetype || 'application/pdf', 'pending'];
      const optionalCols = { file_size: req.file.size, uploaded_by: req.user?.id || null };
      for (const [col, val] of Object.entries(optionalCols)) {
        allCols.push(col);
        allVals.push(val);
      }
      let result;
      for (let attempt = 0; attempt <= allCols.length + 3; attempt++) {
        try {
          result = await tryInsert(allCols, allVals);
          break;
        } catch (e) {
          const msg = e.message || '';
          if (msg.includes('does not exist')) {
            const colMatch = msg.match(/column "(\w+)" of relation/);
            if (colMatch) {
              const badCol = colMatch[1];
              const idx = allCols.indexOf(badCol);
              if (idx !== -1) { allCols.splice(idx, 1); allVals.splice(idx, 1); continue; }
            }
          }
          if (msg.includes('invalid input syntax for type uuid')) {
            // Try passing as text
            const siIdx = allCols.indexOf('stock_id');
            if (siIdx !== -1) {
              allVals[siIdx] = String(allVals[siIdx]);
              // If that also fails, set stock_id to a generated UUID (md5 hash of the integer)
              if (attempt === 1) {
                const crypto = require('crypto');
                const hash = crypto.createHash('md5').update(String(sidVal)).digest('hex');
                allVals[siIdx] = hash.slice(0, 8) + '-' + hash.slice(8, 12) + '-' + hash.slice(12, 16) + '-' + hash.slice(16, 20) + '-' + hash.slice(20, 32);
              }
              continue;
            }
          }
          throw e;
        }
      }
      if (!result) throw new Error('Could not insert after removing columns');
      const docId = result.rows[0].id;
      // Trigger Python parser asynchronously
      const pythonPath = process.env.PYTHON_PATH || 'python';
      const scriptPath = path.join(__dirname, '..', 'scripts', 'parse_financial.py');
      const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`;
      const webhookUrl = `${backendUrl}/api/admin/financial-statements/webhook`;
      const args = [
        scriptPath,
        '--docId', String(docId),
        '--path', req.file.path,
        '--webhook', webhookUrl,
      ];
      if (process.env.OPENAI_API_KEY) {
        args.push('--apiKey', process.env.OPENAI_API_KEY);
        args.push('--model', process.env.OPENAI_MODEL || 'gpt-4o-mini');
      }
      await pool.query(
        `UPDATE financial_statements SET status = 'processing', processed_by = $1 WHERE id = $2`,
        [process.env.OPENAI_API_KEY ? 'python+llm' : 'python', docId]
      );
      const child = spawn(pythonPath, args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      child.on('error', (e) => {
        console.error(`Python spawn error for doc ${docId}:`, e.message);
        pool.query(`UPDATE financial_statements SET status = 'failed', error_message = $1 WHERE id = $2`, [e.message, docId]).catch(() => {});
      });
      child.on('close', (code) => {
        if (code !== 0) {
          console.error(`Python parser exited with code ${code} for doc ${docId}:`, stderr);
          if (code !== null) {
            pool.query(`UPDATE financial_statements SET status = 'failed', error_message = $1 WHERE id = $2`, [`Exit code ${code}: ${stderr.slice(0, 500)}`, docId]).catch(() => {});
          }
        }
        // Cleanup temp file
        try { fs.unlinkSync(req.file.path); } catch (_) {}
      });
      res.status(201).json({ id: docId, status: 'processing', message: 'File uploaded and queued for parsing' });
    } catch (dbErr) {
      console.error('Upload DB error:', dbErr.message);
      try { fs.unlinkSync(req.file.path); } catch (_) {}
      res.status(500).json({ error: dbErr.message || 'Database error during upload' });
    }
  });
});

router.get('/financial-statements/:id/pdf', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT file_name, file_data, mime_type FROM financial_statements WHERE id = $1 AND file_data IS NOT NULL',
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'PDF not found' });
    const { file_name, file_data, mime_type } = result.rows[0];
    res.setHeader('Content-Type', mime_type || 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${file_name}"`);
    res.send(file_data);
  } catch (err) {
    console.error('PDF download error:', err.message);
    res.status(500).json({ error: 'Failed to download PDF' });
  }
});

router.delete('/financial-statements/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM financial_statements WHERE id = $1 RETURNING id', [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Statement not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete statement error:', err.message);
    res.status(500).json({ error: 'Failed to delete statement' });
  }
});

// ── Webhook for Python parser ──

router.post('/financial-statements/webhook', express.json({ type: '*/*' }), async (req, res) => {
  try {
    const { docId, status, parsedData, processedBy, error } = req.body;
    if (!docId) return res.status(400).json({ error: 'docId required' });
    res.status(200).json({ received: true });
    if (status === 'completed' && parsedData) {
      const statementResult = await pool.query(
        'SELECT fs.stock_id, s.ticker FROM financial_statements fs JOIN stocks s ON s.id = fs.stock_id WHERE fs.id = $1',
        [docId]
      );
      if (statementResult.rows.length === 0) return;
      const { stock_id, ticker } = statementResult.rows[0];
      await pool.query(
        `UPDATE financial_statements SET status = 'completed', parsed_data = $1, parsed_at = CURRENT_TIMESTAMP, processed_by = $2 WHERE id = $3`,
        [JSON.stringify(parsedData), processedBy || 'python', docId]
      );
      // Upsert into stock_fundamentals where columns match
      const fundRow = {};
      if (parsedData.dividend_per_share) fundRow.dividend_yield = parsedData.dividend_per_share;
      if (parsedData.eps) fundRow.eps_growth = parsedData.eps;
      const fundKeys = Object.keys(fundRow);
      if (fundKeys.length > 0) {
        const vals = fundKeys.map((_, i) => `$${i + 2}`).join(', ');
        await pool.query(
          `INSERT INTO stock_fundamentals (symbol, ${fundKeys.join(', ')})
           VALUES ($1, ${vals})
           ON CONFLICT (symbol) DO UPDATE SET ${fundKeys.map(k => `${k} = EXCLUDED.${k}`).join(', ')}`,
          [ticker, ...fundKeys.map(k => fundRow[k])]
        );
      }
    } else if (status === 'failed') {
      await pool.query(
        `UPDATE financial_statements SET status = 'failed', error_message = $1 WHERE id = $2`,
        [error || 'Unknown error', docId]
      );
    }
  } catch (err) {
    console.error('Webhook error:', err.message);
  }
});

// ── Fundamentals ──

router.get('/financial-statements/fundamentals/:stockId', async (req, res) => {
  try {
    const { stockId } = req.params;
    const stockResult = await pool.query('SELECT ticker FROM stocks WHERE id = $1', [stockId]);
    if (stockResult.rows.length === 0) return res.status(404).json({ error: 'Stock not found' });
    const ticker = stockResult.rows[0].ticker;
    const fundamentalsResult = await pool.query(
      'SELECT * FROM stock_fundamentals WHERE symbol = $1', [ticker]
    );
    let statements = [];
    try {
      const r = await pool.query(
        `SELECT id, period_type, period_end_date, file_name, status, parsed_data, uploaded_at, parsed_at
         FROM financial_statements WHERE stock_id = $1 ORDER BY uploaded_at DESC`,
        [stockId]
      );
      statements = r.rows;
    } catch {}
    res.json({
      fundamentals: fundamentalsResult.rows[0] || null,
      statements,
    });
  } catch (err) {
    console.error('Fundamentals error:', err.message);
    res.status(500).json({ error: 'Failed to fetch fundamentals' });
  }
});

// ── Stock sectors list ──

router.get('/nse-sectors', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT sector FROM stocks WHERE market = 'NSE' AND sector IS NOT NULL ORDER BY sector`
    );
    res.json(result.rows.map(r => r.sector));
  } catch (err) {
    console.error('Sectors error:', err.message);
    res.status(500).json({ error: 'Failed to fetch sectors' });
  }
});

module.exports = router;
