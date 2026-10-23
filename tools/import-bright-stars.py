"""Extract factual positions/photometry from Yale BSC5 (CDS V/50).

Usage: python3 tools/import-bright-stars.py /path/to/catalog.gz
Source: https://cdsarc.cds.unistra.fr/ftp/V/50/catalog.gz
Byte layout: https://cdsarc.cds.unistra.fr/ftp/V/50/ReadMe
Hoffleit & Warren, Bright Star Catalogue, 5th Revised Ed. (1991).
J2000 RA/declination, visual magnitude and B-V; missing B-V uses 0.65.
"""
import gzip,json,pathlib,sys
rows=[]
for l in gzip.open(sys.argv[1],'rt'):
 if not l[75:83].strip() or not l[102:107].strip(): continue
 mag=float(l[102:107])
 if mag>6.5: continue
 ra=(int(l[75:77])+int(l[77:79])/60+float(l[79:83])/3600)*15
 dec=(int(l[84:86])+int(l[86:88])/60+int(l[88:90])/3600)*(-1 if l[83]=='-' else 1)
 bv=float(l[109:114]) if l[109:114].strip() else .65
 rows.append([round(ra,5),round(dec,5),mag,bv])
p=pathlib.Path(__file__).resolve().parents[1]/'src/sand-lab/bright-stars.json';p.write_text(json.dumps(rows,separators=(',',':'))+'\n')
print('Catalogue stars:',len(rows),'bytes:',p.stat().st_size)
