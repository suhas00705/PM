// api/performance.js — stub for deployment test
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({ ok: true, message: 'stub' });
};
