import zipfile
import os

path = r"D:\Ilzam\Code\Codex\Data\sf_konstruksi_all_mfd_2024_1_generate_kip_ipd_20250327_idsbr_kirim_sbr_20250630_pivot Mas Ade.xlsx"

print(f"File size on disk: {os.path.getsize(path):,} bytes")

with zipfile.ZipFile(path, 'r') as z:
    print(f"Total entries in ZIP: {len(z.infolist())}")
    for info in z.infolist():
        if info.file_size > 1000000:
            print(f"  Large entry: {info.filename} -> Compressed: {info.compress_size:,} bytes | Uncompressed: {info.file_size:,} bytes")
        elif "sheet" in info.filename or "sharedStrings" in info.filename or "workbook" in info.filename:
            print(f"  Entry: {info.filename} -> Compressed: {info.compress_size:,} bytes | Uncompressed: {info.file_size:,} bytes")
