/**
 * Load-bearing side effect — this must be the FIRST import of the worker,
 * before anything that pulls in the npm copy of undici (cheerio, jsdom).
 *
 * The npm undici registers itself as the process-wide fetch dispatcher at
 * module load, under Symbol.for("undici.globalDispatcher.*") keys shared
 * with Node's built-in fetch. Once that happens, EVERY fetch in the process
 * (feed polls, robots, article pages, Anthropic SDK) is parsed by the npm
 * copy — whose v7.28 HTTP parser dies with an uncaught AssertionError in
 * Parser.finish when a server closes a keep-alive socket uncleanly. News
 * CDNs do this constantly; it crashed the worker 5–24×/hour during the soak
 * (first hit 2026-07-07 22:46, the moment stage 4 first loaded jsdom).
 *
 * Calling fetch() here makes Node's internal undici claim the dispatcher
 * symbol first; the npm copy then sees it defined and leaves it alone. The
 * data: URL resolves without touching the network, and registration happens
 * synchronously inside the call.
 */
void fetch("data:text/plain,").catch(() => {});
