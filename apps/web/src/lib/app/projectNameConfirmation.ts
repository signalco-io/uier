function normalizeName(name: string) {
    return name.trim().replace(/ +/g, ' ');
}

export function matchesProjectNameConfirmation(confirmation: string, projectName: string) {
    const enteredName = normalizeName(confirmation);
    return enteredName.length > 0 && enteredName === normalizeName(projectName);
}
