/**
 * utils/serverError.js
 *
 * The one way a route reports an unexpected failure.
 *
 * 174 handlers used to answer `message: err.message` on a 500, which handed the
 * caller whatever Postgres had said — column names, table names, constraint
 * names. Two routes disclosed their schema that way for months while looking
 * like ordinary server errors, and because nothing logged the error either,
 * a permanently broken query stayed invisible.
 *
 * The two halves matter equally: the caller gets a fixed sentence, and the
 * detail goes to the log where somebody can actually find it.
 *
 * Deliberate 4xx validation messages are NOT this. A handler that throws its
 * own "Choose at least one recipient" is describing the request, not the
 * database, and those still answer with their own text.
 */
const logger = require('../logger');

const MESSAGE = 'An internal server error occurred';

function serverError(res, err, context) {
  logger.error(
    { err: err?.message, stack: err?.stack, code: err?.code, ...(context ? { context } : {}) },
    'request failed'
  );
  return res.status(500).json({ success: false, message: MESSAGE });
}

module.exports = { serverError, INTERNAL_MESSAGE: MESSAGE };
