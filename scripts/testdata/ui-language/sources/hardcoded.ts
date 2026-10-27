export function render(name: string) {
  const label = 'Work not found';
  const created = `Created ${name}`;
  const action = { text: 'Save file', target: name };
  return { label, created, action };
}
