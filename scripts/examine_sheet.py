import zipfile
import xml.etree.ElementTree as ET

path = r"D:\Ilzam\Code\Codex\Data\sf_konstruksi_all_mfd_2024_1_generate_kip_ipd_20250327_idsbr_kirim_sbr_20250630_pivot Mas Ade.xlsx"

with zipfile.ZipFile(path, 'r') as z:
    # Read workbook to see sheet names
    wb_xml = z.read("xl/workbook.xml")
    root = ET.fromstring(wb_xml)
    print("Sheets:")
    for elem in root.iter():
        if elem.tag.endswith("sheet"):
            print(" ", elem.attrib)

    # Read first 1000 bytes of sheet1.xml
    with z.open("xl/worksheets/sheet1.xml") as f:
        head = f.read(1500).decode("utf-8", errors="ignore")
        print("\nSheet1 head:\n", head[:800])
