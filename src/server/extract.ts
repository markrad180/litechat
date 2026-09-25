import { unzipSync } from 'fflate';
import { extractText } from 'unpdf';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { OfficeParser, OfficeGenerator } from 'officeparser';

export interface Extracted {
	text?: string;
	isImage: boolean;
	/** User-facing reason (shown verbatim in the chip) when state is 'error'. */
	error?: string;
}

const TEXT_EXTS = new Set([
	'txt', 'md', 'markdown', 'rst', 'adoc',
	'csv', 'tsv', 'json', 'yaml', 'yml', 'toml', 'ini', 'xml', 'ndjson',
	'html', 'htm', 'svg', 'css', 'scss',
	'js', 'ts', 'jsx', 'tsx', 'mjs', 'py', 'go', 'rs', 'java', 'kt', 'c', 'cpp', 'h', 'hpp',
	'rb', 'php', 'sh', 'bash', 'sql', 'vue', 'svelte', 'dart', 'swift',
	'log', 'env', 'conf'
]);

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp']);

// ponytail: <32 non-whitespace chars counts as "no text" (scanned docs); a deliberately
// tiny real file will trip this — the chip message says exactly what happened.
const MIN_TEXT = 32;

const ZIP_MAX_ENTRIES = 20;
const ZIP_MAX_DEPTH = 2;
const ZIP_MAX_ENTRY = 5 * 1024 * 1024;

function extOf(name: string): string {
	return (name.split('.').pop() ?? '').toLowerCase();
}

function reason(e: unknown): string {
	const msg = e instanceof Error ? e.message : String(e);
	return msg.length > 120 ? `${msg.slice(0, 117)}…` : msg;
}

function unsupported(name: string): string {
	return `Unsupported format (.${extOf(name)}) — supported: text/code, pdf, docx, xlsx, pptx, epub, zip, images`;
}

async function pdfText(bytes: Uint8Array): Promise<string> {
	// unpdf 1.x returns text per-page by default; mergePages gives one string.
	// Copy the bytes: unpdf detaches the underlying ArrayBuffer (pdf.js worker
	// transfer), which would break the caller's copy after extract() returns.
	const { text } = await extractText(new Uint8Array(bytes), { mergePages: true });
	return text;
}

async function docxText(bytes: Uint8Array): Promise<string> {
	// mammoth 1.12 only accepts a Buffer (or a path), not an ArrayBuffer
	const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
	return value;
}

function sheetText(bytes: Uint8Array): string {
	const wb = XLSX.read(bytes, { type: 'buffer' });
	const parts: string[] = [];
	for (const name of wb.SheetNames.slice(0, 10)) {
		parts.push(`=== ${name} ===\n${XLSX.utils.sheet_to_csv(wb.Sheets[name])}`);
	}
	return parts.join('\n\n');
}

async function pptxText(bytes: Uint8Array): Promise<string> {
	const ast = await OfficeParser.parseOffice(bytes);
	const { value } = await OfficeGenerator.generate(ast, 'md');
	return value;
}

// ponytail: regex HTML strip, a real XHTML parser if epub fidelity matters
function stripHtml(html: string): string {
	return html
		.replace(/<script[\s\S]*?<\/script>/gi, ' ')
		.replace(/<style[\s\S]*?<\/style>/gi, ' ')
		.replace(/<br[^>]*>/gi, '\n')
		.replace(/<\/(p|div|h[1-6]|li|tr|blockquote|pre|section|article|header|footer)>/gi, '\n')
		.replace(/<[^>]+>/g, '')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, ' ')
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function epubText(bytes: Uint8Array): string {
	const entries = unzipSync(bytes);
	const chapters = Object.keys(entries)
		.filter((n) => /\.(x?html?)$/i.test(n) && !/cover\.i/i.test(n))
		.slice(0, 50);
	return chapters
		.map((n) => stripHtml(new TextDecoder().decode(entries[n])))
		.filter(Boolean)
		.join('\n\n');
}

// Recurses through extract() so archives of pdf/docx work too. Entry failures become
// marker lines — the model sees that an entry was unreadable, and the rest survives.
async function zipText(bytes: Uint8Array): Promise<string> {
	const entries = Object.entries(unzipSync(bytes)); // ponytail: unzipSync decompresses fully in memory; the 20 MB upload cap bounds it
	const jobs = entries.slice(0, ZIP_MAX_ENTRIES).map(async ([name, data]) => {
		const depth = name.split('/').length - 1;
		if (depth > ZIP_MAX_DEPTH) return `--- ${name} (skipped: nested too deep)`;
		if (data.length > ZIP_MAX_ENTRY) return `--- ${name} (skipped: over ${ZIP_MAX_ENTRY / 1024 / 1024} MB)`;
		if (!TEXT_EXTS.has(extOf(name)) && !IMAGE_EXTS.has(extOf(name)))
			return `--- ${name} (skipped: unsupported type in archive)`;
		const res = await extract(name, data);
		if (res.isImage) return `--- ${name} (skipped: image, not re-attached)`;
		if (res.error) return `--- ${name} (skipped: ${res.error})`;
		return `--- ${name} ---\n${res.text}`;
	});
	if (entries.length > ZIP_MAX_ENTRIES)
		jobs.push(Promise.resolve(`--- (${entries.length - ZIP_MAX_ENTRIES} more entries not read) ---`));
	const parts = await Promise.all(jobs);
	return parts.join('\n\n');
}

export async function extract(filename: string, bytes: Uint8Array): Promise<Extracted> {
	const ext = extOf(filename);
	let text: string;
	try {
		if (IMAGE_EXTS.has(ext)) return { isImage: true };
		if (TEXT_EXTS.has(ext)) text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
		else if (ext === 'pdf') text = await pdfText(bytes);
		else if (ext === 'docx') text = await docxText(bytes);
		else if (['xlsx', 'xls', 'ods'].includes(ext)) text = sheetText(bytes);
		else if (ext === 'pptx') text = await pptxText(bytes);
		else if (ext === 'epub') text = epubText(bytes);
		else if (ext === 'zip') text = await zipText(bytes);
		else return { isImage: false, error: unsupported(filename) };

		// Empty extraction is an explicit error, not a silent success: a scanned PDF
		// that parses "fine" would otherwise give the model nothing with no explanation.
		if (text.replace(/\s/g, '').length < MIN_TEXT)
			return {
				isImage: false,
				error: `No extractable text in ${filename} — scanned documents need OCR (not in this version)`
			};
		return { text, isImage: false };
	} catch (e) {
		return { isImage: false, error: `Couldn't read ${filename} — ${reason(e)}` };
	}
}
