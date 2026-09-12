/* Deterministic evidence scores, not probabilities. No I/O or content writes. */
// Reviewed v0.104.1 native Code MIME catalogue; see CLDS-0047-REVIEW.md.
const THG_LANGUAGES = [
    ['plain', 'Plain Text / Unknown', 'text/plain'], ['python', 'Python', 'text/x-python'],
    ['javascript', 'JavaScript', 'text/javascript'], ['typescript', 'TypeScript', 'application/typescript'],
    ['json', 'JSON', 'application/json'], ['shell', 'Bash / Shell', 'text/x-sh'],
    ['c', 'C', 'text/x-csrc'], ['cpp', 'C++', 'text/x-c++src'], ['java', 'Java', 'text/x-java'],
    ['kotlin', 'Kotlin', 'text/x-kotlin'], ['swift', 'Swift', 'text/x-swift'], ['rust', 'Rust', 'text/x-rustsrc'],
    ['go', 'Go', 'text/x-go'], ['yaml', 'YAML', 'text/x-yaml'], ['sql', 'SQL', 'text/x-sql'],
    ['html', 'HTML', 'text/html'], ['css', 'CSS', 'text/css'], ['markdown', 'Markdown', 'text/x-markdown'],
    ['dockerfile', 'Dockerfile', 'text/x-dockerfile']
];
const THG_RULES = {
    python: [/^\s*(?:async )?def \w+\([^\n]*\):/m, /^\s*(?:from [\w.]+ import |import \w+)/m, /^\s*(?:return .+|print\(.+\)|if .+:|class \w+.*:)$/m],
    javascript: [/\b(?:const|let|var) \w+\s*=/, /(?:=>|\bfunction\s+\w+\s*\()/, /(?:console\.log\(|module\.exports\s*=|\bexport default\b)/],
    typescript: [/\b(?:interface|type) [A-Z]\w*\s*(?:\{|=)/, /\b\w+\??:\s*(?:string|number|boolean)\b/, /\b(?:const|let|export|implements)\b/],
    shell: [/^#![^\n]*\b(?:bash|sh|zsh)\b/, /^\s*(?:export \w+=|\w+=\$\()/m, /\$(?:\{\w+\}|\w+)|(?:^|[;\n])\s*(?:then|fi|done)\s*(?:[;\n]|$)/, /^\s*(?:echo|printf|set -[a-z]+)\s/m],
    c: [/^\s*#include\s*<\w+\.h>/m, /\b(?:int|void) \w+\([^)]*\)\s*\{/, /\b(?:printf|malloc|free)\s*\(/],
    cpp: [/^\s*#include\s*<(?:iostream|vector|string|memory)>/m, /\bstd::\w+/, /\b(?:template\s*<|cout\s*<<|class \w+\s*\{)/],
    java: [/\bpublic (?:static |final )?(?:class|void|int|String)\b/, /\b(?:System\.out\.println|new \w+\()/, /^\s*(?:package|import) [\w.]+;/m],
    kotlin: [/\bfun \w+\([^)]*\)/, /\b(?:val|var) \w+\s*(?::[^=\n]+)?=/, /\b(?:println\(|data class |object \w+)/],
    swift: [/\bfunc \w+\([^)]*\)/, /\b(?:let|var) \w+\s*:\s*(?:String|Int|Double|Bool)\b/, /\b(?:import Swift|import Foundation|print\()/],
    rust: [/\bfn \w+\([^)]*\)/, /\b(?:let mut |use \w+::|impl \w+)/, /\b(?:println!|Some\(|Result<)/],
    go: [/^package \w+/m, /\bfunc (?:\([^)]*\) )?\w+\([^)]*\)/, /(?:fmt\.Print|\w+\s*:=)/],
    yaml: [/^\w[\w-]*:\s*(?:$|[\w"'])/m, /^ +[\w-]+:\s*\S/m, /^ +[-]\s+\S/m],
    sql: [/\bSELECT\s+(?:[\w.* ,]+)\s+FROM\s+\w+/i, /\b(?:WHERE\s+\w+\s*[=<>]|JOIN\s+\w+\s+ON|ORDER BY\s+\w+|GROUP BY\s+\w+)/i, /\bCREATE TABLE\s+\w+\s*\(/i],
    html: [/<!doctype html>/i, /<(?:html|body|div|p|section|head)(?:\s[^>]*|)>/i, /<\/(?:html|body|div|p|section|head)>/i],
    css: [/(?:^|\n)\s*[.#]?[\w-]+(?:\s+[.#]?[\w-]+)*\s*\{/, /\b(?:color|display|margin|padding|background):\s*[^;\n]+;/, /\}/],
    markdown: [/^#{1,6} \S/m, /\[[^\]\n]+\]\([^\s)]+\)/, /^\s*[-*] \S/m, /^```\w*$/m],
    dockerfile: [/^FROM [\w./:-]+/m, /^RUN \S/m, /^(?:COPY|WORKDIR|ENTRYPOINT|CMD|EXPOSE) \S/m]
};
function thgRank(raw) {
    // A script shebang establishes hash-comment context, including Markdown-like comments.
    const scriptContext = /^#!/.test(raw.trimStart());
    // Ignore comment-only grammar. Preserve shebangs, preprocessor directives and Markdown headings.
    const markup = raw.replace(/<!--[\s\S]*?(?:-->|$)/g, '')
        .replace(/\/\*[\s\S]*?(?:\*\/|$)/g, '').replace(/^\s*(?:\/\/|--).*$/gm, '');
    const text = markup.replace(/^\s*#(?!!|include\b).*$/gm, '');
    return Object.entries(THG_RULES).map(([id, rules]) => {
        const count = rules.reduce((n, rule) => n + Number(rule.test(id === 'markdown' && !scriptContext ? markup : text)), 0);
        return { id, count, confidence: count >= 2 ? Math.min(96, 60 + count * 10) : 0 };
    }).sort((a, b) => b.confidence - a.confidence);
}
function thgDetect(content, title = '') {
    const unknown = { id: 'plain', name: THG_LANGUAGES[0][1], confidence: 0 };
    if (typeof content !== 'string') return unknown;
    const raw = content.slice(0, 32768).trim();
    if (raw.length < 16) return unknown;
    if (content.length <= 32768 && /^[\[{]/.test(raw)) {
        try { const value = JSON.parse(raw); if (value && typeof value === 'object' && Object.keys(value).length >= 2)
            return { id: 'json', name: 'JSON', confidence: 98 }; } catch (_) { /* Not JSON. */ }
    }
    if (raw.split('\n').some(line => line.length > 1024)) return unknown;
    const ranked = thgRank(raw);
    const best = ranked[0];
    if (!best.confidence || best.confidence - ranked[1].confidence < 10) return unknown;
    return { id: best.id, name: THG_LANGUAGES.find(l => l[0] === best.id)[1], confidence: best.confidence };
}
function thgAdvance(state, content, title) {
    const candidate = thgDetect(content, title);
    // Insufficient/ambiguous current evidence invalidates stale confidence immediately.
    // Do this before the unchanged-refresh guard: rereading cannot revive old evidence.
    if (candidate.id === 'plain')
        return { current: candidate, pending: null, repeats: 0, content };
    if (!state || state.current.id === candidate.id) return { current: candidate, pending: null, repeats: 0, content };
    if (content === state.content) return state; // Refresh is not new evidence.
    const repeats = state.pending === candidate.id ? state.repeats + 1 : 1;
    const bounded = typeof content === 'string' ? content.slice(0, 32768) : '';
    const incumbent = thgRank(bounded.split('\n').some(line => line.length > 1024) ? '' : bounded)
        .find(result => result.id === state.current.id)?.confidence || 0;
    if (repeats >= 2 && candidate.confidence >= incumbent + 15)
        return { current: candidate, pending: null, repeats: 0, content };
    return { ...state, pending: candidate.id, repeats, content };
}
