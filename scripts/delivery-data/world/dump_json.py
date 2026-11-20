"""Dumps cached Overture parquet extracts to JSON for the node bake scripts. usage: python dump_json.py <cacheDir>"""
import duckdb, json, sys
c = sys.argv[1]; con = duckdb.connect()
json.dump(con.execute(f"select name,class,elevation,lon,lat from read_parquet('{c}/peaks.parquet') where elevation is not null").fetchall(), open(c + '/peaks.json', 'w'))
json.dump(con.execute(f"select name,subtype,lon,lat from read_parquet('{c}/places.parquet') where name is not null").fetchall(), open(c + '/places.json', 'w'))
print('ok')
