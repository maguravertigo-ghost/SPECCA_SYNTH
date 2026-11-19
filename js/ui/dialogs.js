// In-page dialogs instead of blocking window.confirm/prompt calls.
function ask({ title, message, label, value = '', action }) {
    return new Promise(resolve => {
        const dialog = document.createElement('dialog');
        dialog.className = 'arr-dialog-box app-dialog';
        dialog.setAttribute('aria-label', title);
        dialog.innerHTML = `<form method="dialog">
            <h2 class="arr-dialog-title"></h2><div class="arr-dialog-body"></div>
            <div class="arr-dialog-footer">
                <button class="btn" type="button" data-cancel>Cancel</button>
                <button class="btn btn-primary" value="accept" data-apply></button>
            </div>
        </form>`;
        dialog.querySelector('h2').textContent = title;
        dialog.querySelector('[data-apply]').textContent = action;
        const body = dialog.querySelector('.arr-dialog-body');
        if (message) body.textContent = message;
        let input;
        if (label) {
            const field = document.createElement('label');
            field.className = 'arr-field';
            const name = document.createElement('span'); name.textContent = label;
            input = document.createElement('input');
            input.type = 'text'; input.required = true; input.maxLength = 160; input.value = value;
            input.addEventListener('input', () => input.setCustomValidity(''));
            dialog.querySelector('form').addEventListener('submit', event => {
                if (input.value.trim()) return;
                event.preventDefault(); input.setCustomValidity('Enter a name.'); input.reportValidity();
            });
            field.append(name, input); body.append(field);
        }
        const cancel = dialog.querySelector('[data-cancel]');
        cancel.addEventListener('click', () => dialog.close());
        dialog.addEventListener('close', () => {
            const result = dialog.returnValue === 'accept' ? (input?.value.trim() ?? true) : null;
            dialog.remove(); resolve(result);
        }, { once: true });
        document.body.append(dialog); dialog.showModal(); (input ?? cancel).focus();
    });
}

export const confirmAction = (title, message, action = 'Delete') => ask({ title, message, action });
export const askName = (title, label, value) => ask({ title, label, value, action: 'Save' });
