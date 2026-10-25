import { randomUUID } from './browser-crypto.js';
import { imageDimensions, imageWithinLimits } from './image-content.js';
export class ImageDrafts {
    changed;
    drafts = new Map();
    generation = 0;
    owners = new Map();
    constructor(changed) {
        this.changed = changed;
    }
    get(key) { return this.drafts.get(key) ?? []; }
    groups() { return [...this.drafts.values()]; }
    move(from, to) { if (from === to)
        return; const images = this.drafts.get(from); if (images?.length && !this.get(to).length) {
        this.drafts.set(to, images);
        this.drafts.delete(from);
        for (const image of images)
            this.owners.set(image.id, to);
    } }
    remove(key, id) { key = this.owners.get(id) ?? key; const images = this.get(key); const image = images.find(i => i.id === id); if (image)
        URL.revokeObjectURL(image.url); this.owners.delete(id); this.drafts.set(key, images.filter(i => i.id !== id)); this.changed(); }
    clear() { this.generation++; for (const images of this.drafts.values())
        for (const image of images)
            URL.revokeObjectURL(image.url); this.drafts.clear(); this.owners.clear(); }
    capture(key) { const images = this.get(key); if (images.some(i => i.reading))
        throw new Error('Images are still being checked.'); return images; }
    consume(key, snapshot) { for (const image of snapshot)
        if (this.owners.has(image.id))
            this.remove(key, image.id); }
    async add(key, files, current) {
        const errors = [], generation = this.generation;
        for (const file of files) {
            if (generation !== this.generation || !current())
                break;
            if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
                errors.push(`${file.name}: Use PNG, JPEG or WebP.`);
                continue;
            }
            const existing = this.get(key);
            if (file.size === 0 || file.size > 5 * 1024 ** 2 || existing.length >= 4 || existing.reduce((n, i) => n + i.bytes, 0) + file.size > 10 * 1024 ** 2) {
                errors.push(`${file.name}: Up to 4 images, 5 MiB each and 10 MiB total.`);
                continue;
            }
            const item = { id: randomUUID(), name: file.name || 'Pasted image', bytes: file.size, url: URL.createObjectURL(file), reading: true };
            this.drafts.set(key, [...existing, item]);
            this.owners.set(item.id, key);
            this.changed();
            try {
                const buffer = await file.arrayBuffer();
                checkDimensions(file.type, new Uint8Array(buffer));
                const preview = await createImageBitmap(file);
                preview.close();
                if (generation !== this.generation || !current() || !this.get(this.owners.get(item.id) ?? key).includes(item)) {
                    this.remove(key, item.id);
                    continue;
                }
                let raw = '';
                const bytes = new Uint8Array(buffer);
                for (let i = 0; i < bytes.length; i += 8192)
                    raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
                item.input = { mimeType: file.type, data: btoa(raw) };
                item.reading = false;
                this.changed();
            }
            catch {
                this.remove(key, item.id);
                if (generation === this.generation && current())
                    errors.push(`${item.name}: The image is invalid or exceeds 8192 pixels per side / 40 million pixels.`);
            }
        }
        return errors;
    }
}
function checkDimensions(mime, b) {
    const { width, height } = imageDimensions(mime, b);
    if (!imageWithinLimits(width, height))
        throw new Error('Invalid image dimensions');
}
//# sourceMappingURL=images.js.map