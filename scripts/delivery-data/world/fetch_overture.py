"""Fetches Overture Maps (release 2026-10-21.0) data for Nepal into a cache dir (not the repo).
usage: python fetch_overture.py <cacheDir> <buildings|roads|places>
Needs: pip install duckdb. Licences: Overture buildings = ODbL (OSM) + CDLA-Permissive-2.0 (Microsoft ML footprints, Google Open Buildings);
transportation = ODbL (OSM); divisions = ODbL/CC0 mix (OSM, geoBoundaries)."""
import duckdb, sys, os, time
cache, what = sys.argv[1], sys.argv[2]
os.makedirs(cache, exist_ok=True)
R = '2026-10-21.0'
con = duckdb.connect()
con.execute("INSTALL httpfs;LOAD httpfs;INSTALL spatial;LOAD spatial;SET s3_region='us-west-2';SET threads=8;")
BB = "bbox.xmin between 79.2 and 89.0 and bbox.ymin between 25.6 and 31.2"
base = f"s3://overturemaps-us-west-2/release/{R}/theme="
t = time.time()
if what == 'buildings':
    lon0, dlon, lat1, dlat = 79.2, 0.0050879, 31.2, 0.0045
    q = f"""copy (select cast(floor(((bbox.xmin+bbox.xmax)/2-{lon0})/{dlon}) as int) gx, cast(floor(({lat1}-(bbox.ymin+bbox.ymax)/2)/{dlat}) as int) gy,
      count(*) n,
      sum(sqrt(((bbox.xmax-bbox.xmin)*111320*cos(radians((bbox.ymin+bbox.ymax)/2)))*((bbox.ymax-bbox.ymin)*110570))) szsum,
      sum(cos(4*atan2((ST_Y(ST_PointN(ST_ExteriorRing(geometry),2))-ST_Y(ST_PointN(ST_ExteriorRing(geometry),1)))*110570,
                      (ST_X(ST_PointN(ST_ExteriorRing(geometry),2))-ST_X(ST_PointN(ST_ExteriorRing(geometry),1)))*111320*cos(radians((bbox.ymin+bbox.ymax)/2))))) c4,
      sum(sin(4*atan2((ST_Y(ST_PointN(ST_ExteriorRing(geometry),2))-ST_Y(ST_PointN(ST_ExteriorRing(geometry),1)))*110570,
                      (ST_X(ST_PointN(ST_ExteriorRing(geometry),2))-ST_X(ST_PointN(ST_ExteriorRing(geometry),1)))*111320*cos(radians((bbox.ymin+bbox.ymax)/2))))) s4
      from read_parquet('{base}buildings/type=building/*',hive_partitioning=1) where {BB} group by 1,2) to '{cache}/buildings_agg.parquet' (format parquet)"""
elif what == 'buildings_lite':
    # bbox-only variant (no geometry column read): counts and mean footprint size, orientation filled with 0
    lon0, dlon, lat1, dlat = 79.2, 0.0050879, 31.2, 0.0045
    q = f"""copy (select cast(floor(((bbox.xmin+bbox.xmax)/2-{lon0})/{dlon}) as int) gx, cast(floor(({lat1}-(bbox.ymin+bbox.ymax)/2)/{dlat}) as int) gy,
      count(*) n, sum(sqrt(((bbox.xmax-bbox.xmin)*111320*cos(radians((bbox.ymin+bbox.ymax)/2)))*((bbox.ymax-bbox.ymin)*110570))) szsum, 0.0 c4, 0.0 s4
      from read_parquet('{base}buildings/type=building/*',hive_partitioning=1) where {BB} group by 1,2) to '{cache}/buildings_agg_lite.parquet' (format parquet)"""
elif what == 'roads':
    q = f"""copy (select class, ST_AsText(geometry) wkt from read_parquet('{base}transportation/type=segment/*',hive_partitioning=1)
      where subtype='road' and class in ('motorway','trunk','primary','secondary','tertiary') and {BB}) to '{cache}/roads.parquet' (format parquet)"""
elif what == 'airports':
    q = f"""copy (select class, names.primary name, ST_AsText(geometry) wkt from read_parquet('{base}base/type=infrastructure/*',hive_partitioning=1)
      where class in ('runway','taxiway','apron','helipad','airport_terminal') and {BB}) to '{cache}/airports.parquet' (format parquet)"""
elif what == 'peaks':
    q = f"""copy (select names.primary name, class, elevation, ST_X(geometry) lon, ST_Y(geometry) lat from read_parquet('{base}base/type=land/*',hive_partitioning=1)
      where class in ('peak','volcano','saddle') and bbox.xmin between 79 and 89.5 and bbox.ymin between 25.5 and 31.5) to '{cache}/peaks.parquet' (format parquet)"""
elif what == 'places':
    q = f"""copy (select names.primary name, subtype, class, ST_X(ST_Centroid(geometry)) lon, ST_Y(ST_Centroid(geometry)) lat, population
      from read_parquet('{base}divisions/type=division/*',hive_partitioning=1) where country='NP' and subtype in ('locality','localadmin','county','region','neighborhood')) to '{cache}/places.parquet' (format parquet)"""
con.execute(q)
print(what, 'done', round(time.time() - t), 's')
