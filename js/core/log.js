const logBox = document.getElementById('logBox');
const statusEl = document.getElementById('status');
const logs = [];

export function log(message, level = 'info') {
    const time = new Date().toLocaleTimeString();
    const line = `[${time}] ${message}`;
    logs.push(line);
    if (logBox) {
        const span = document.createElement('span');
        span.className = `log-${level}`;
        span.textContent = line + '\n';
        logBox.appendChild(span);
        logBox.scrollTop = logBox.scrollHeight;
    }
    console.log(line);
}

export function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
    log(`STATUS: ${text}`);
}

export function wireGlobalErrorHandlers() {
    window.addEventListener('error', e => log(`UNCAUGHT ERROR: ${e.message}`, 'error'));
    window.addEventListener('unhandledrejection', e => log(`UNHANDLED REJECTION: ${e.reason}`, 'error'));
}