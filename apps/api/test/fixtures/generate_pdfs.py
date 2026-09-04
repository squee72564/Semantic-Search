"""Regenerate synthetic PDF fixtures with pypdf (no production or third-party data)."""
from pathlib import Path
from pypdf import PdfWriter

root = Path(__file__).resolve().parent
writer = PdfWriter()
writer.add_blank_page(width=72, height=72)
writer.write(root / "readable.pdf")
writer.encrypt("test-password", algorithm="RC4-128")
writer.write(root / "encrypted.pdf")
writer = PdfWriter()
writer.add_blank_page(width=72, height=72)
writer.encrypt("", owner_password="test-owner", algorithm="RC4-128")
writer.write(root / "encrypted-empty-password.pdf")
data = (root / "readable.pdf").read_bytes()
(root / "truncated.pdf").write_bytes(data[:len(data) // 2])
(root / "malformed.pdf").write_bytes(b"%PDF-1.7\nnot a PDF object graph\n")
