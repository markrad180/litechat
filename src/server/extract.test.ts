import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import * as XLSX from 'xlsx';
import { extract } from './extract.js';

const enc = (s: string) => new TextEncoder().encode(s);
// must exceed the 32 non-whitespace-char "empty extraction" threshold
const DOC_TEXT = 'The quick brown fox jumps over the lazy dog, twice, in a row.';

// Minimal valid PDF with exact xref offsets — pdfjs is strict about them, so the
// offsets are computed, not hand-written.
function makePdf(text: string): Uint8Array {
	// 12pt so the line fits the 612pt-wide page — pdfjs clips text past the edge
	const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
	const objs = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
		`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
		'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
	];
	let pdf = '%PDF-1.4\n';
	const offsets: number[] = [];
	objs.forEach((body, i) => {
		offsets.push(pdf.length);
		pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
	});
	const xrefPos = pdf.length;
	pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
	for (const o of offsets) pdf += `${String(o).padStart(10, '0')} 00000 n \n`;
	pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
	return enc(pdf);
}

function makeDocx(text: string): Uint8Array {
	const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`;
	const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
	const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
	return zipSync({
		'[Content_Types].xml': enc(types),
		'_rels/.rels': enc(rels),
		'word/document.xml': enc(doc)
	});
}

function makePptx(text: string): Uint8Array {
	const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>`;
	const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`;
	const presentation = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>`;
	const presRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`;
	const slide = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
	return zipSync({
		'[Content_Types].xml': enc(types),
		'_rels/.rels': enc(rels),
		'ppt/presentation.xml': enc(presentation),
		'ppt/_rels/presentation.xml.rels': enc(presRels),
		'ppt/slides/slide1.xml': enc(slide)
	});
}

describe('extract', () => {
	it('reads raw text/code by extension', async () => {
		const res = await extract('notes.md', enc(`# Title\n\n${DOC_TEXT}`));
		expect(res.isImage).toBe(false);
		expect(res.text).toContain(DOC_TEXT);
	});

	it('flags images without extracting', async () => {
		expect(await extract('a.png', enc('whatever'))).toEqual({ isImage: true });
	});

	it('rejects unsupported extensions with a named reason', async () => {
		const res = await extract('setup.exe', enc('MZ'));
		expect(res.isImage).toBe(false);
		expect(res.error).toBe('Unsupported format (.exe) — supported: text/code, pdf, docx, xlsx, pptx, epub, zip, images');
	});

	it('treats empty extraction as an explicit error (scanned docs)', async () => {
		const res = await extract('scan.pdf', makePdf(''));
		expect(res.text).toBeUndefined();
		expect(res.error).toBe('No extractable text in scan.pdf — scanned documents need OCR (not in this version)');
	});

	it('extracts text from a real PDF', async () => {
		const res = await extract('doc.pdf', makePdf(DOC_TEXT));
		expect(res.text).toContain(DOC_TEXT);
	});

	it('leaves the caller\'s PDF bytes usable after extraction (unpdf detaches its copy)', async () => {
		const bytes = makePdf(DOC_TEXT);
		await extract('doc.pdf', bytes);
		// saveAttachment writes these bytes back to disk right after extract();
		// a detached buffer has byteLength 0 and throws on new Uint8Array()
		expect(bytes.byteLength).toBeGreaterThan(0);
		expect(bytes[0]).toBe(0x25); // '%' of %PDF
	});

	it('extracts text from a real DOCX', async () => {
		const res = await extract('doc.docx', makeDocx(DOC_TEXT));
		expect(res.text).toContain(DOC_TEXT);
	});

	it('extracts text from a real XLSX as per-sheet CSV', async () => {
		const wb = XLSX.utils.book_new();
		// >32 non-whitespace chars total — the empty-extraction threshold
		XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['name', 'qty', 'unit'], ['apples', 3, 'kg'], ['pears', 5, 'kg']]), 'Inventory');
		const bytes = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
		const res = await extract('data.xlsx', bytes);
		expect(res.text).toContain('=== Inventory ===');
		expect(res.text).toContain('apples,3');
	});

	it('extracts text from a real PPTX', async () => {
		const res = await extract('slides.pptx', makePptx(DOC_TEXT));
		expect(res.text).toContain(DOC_TEXT);
	});

	it('extracts epub chapters and strips their HTML', async () => {
		const epub = zipSync({
			'mimetype': enc('application/epub+zip'),
			'OEBPS/content.opf': enc('<package/>'),
			'OEBPS/chapter1.xhtml': enc(`<html><body><p>${DOC_TEXT}</p><script>var x = 1;</script></body></html>`)
		});
		const res = await extract('book.epub', epub);
		expect(res.text).toContain(DOC_TEXT);
		expect(res.text).not.toContain('var x');
	});

	it('extracts zip entries with per-entry markers and skip reasons', async () => {
		const zip = zipSync({
			'notes/a.txt': enc(DOC_TEXT),
			'notes/skip.bin': enc('binary junk'),
			'deep/nested/deeper/x.txt': enc('nested should be skipped — too deep')
		});
		const res = await extract('bundle.zip', zip);
		expect(res.text).toContain('--- notes/a.txt ---');
		expect(res.text).toContain(DOC_TEXT);
		expect(res.text).toContain('--- notes/skip.bin (skipped: unsupported type in archive)');
		expect(res.text).toContain('--- deep/nested/deeper/x.txt (skipped: nested too deep)');
	});

	it('wraps parser crashes in a per-file reason, not a throw', async () => {
		const res = await extract('broken.docx', enc('not a zip at all'));
		expect(res.isImage).toBe(false);
		expect(res.text).toBeUndefined();
		expect(res.error?.startsWith("Couldn't read broken.docx")).toBe(true);
	});
});
