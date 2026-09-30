"""Local semantic search over the three meshes prepared for this experiment."""
from __future__ import annotations

import argparse
from http.server import ThreadingHTTPServer
import json
import math
from pathlib import Path
import re
import signal
import time

from app import handler_for, MAX_BODY
from interpreter import Embeddings, MAX_TEXT

ROOT=Path(__file__).resolve().parents[1]
MANIFEST=ROOT/'public/retrieval-models/manifest.json'


def catalogue(path=MANIFEST):
    data=json.loads(path.read_text())
    rows=data if type(data) is list else data.get('models') if type(data) is dict else None
    if type(rows) is not list or not 1<=len(rows)<=32:raise ValueError('Invalid local asset catalogue')
    clean=[];ids=set()
    for row in rows:
        if type(row) is not dict:raise ValueError('Invalid catalogue row')
        identity=row.get('id');name=row.get('name');description=row.get('description');model_path=row.get('path')
        if type(identity) is not str or not re.fullmatch(r'[a-z0-9_-]{1,80}',identity) or identity in ids:raise ValueError('Invalid asset identity')
        if type(name) is not str or not 1<=len(name)<=200 or type(description) is not str or not 1<=len(description)<=1200:raise ValueError('Invalid local asset caption')
        if type(model_path) is not str:raise ValueError('Invalid asset path')
        if not model_path.startswith('/'):model_path='/retrieval-models/'+model_path
        if not re.fullmatch(r'/retrieval-models/[a-zA-Z0-9_.-]+\.glb',model_path) or '..' in model_path:raise ValueError('Invalid local mesh path')
        source=row.get('source')
        if type(source) is not str or not re.fullmatch(r'https://polyhaven\.com/a/[a-z0-9_-]+',source):raise ValueError('Invalid source page')
        mesh=(ROOT/'public'/model_path.lstrip('/')).resolve()
        allowed=(ROOT/'public/retrieval-models').resolve()
        if not mesh.is_relative_to(allowed) or not mesh.is_file():raise ValueError('Local mesh is missing or outside the catalogue')
        ids.add(identity);clean.append(dict(id=identity,name=name,description=description,path=model_path,source=source))
    return clean


class Retriever:
    def __init__(self,model,rows):
        self.model=model;self.rows=rows
        self.vectors=model.encode([row['name']+'. '+row['description'] for row in rows])

    def search(self,text):
        if type(text) is not str or not 1<=len(text.strip())<=MAX_TEXT or len(text)>MAX_TEXT:raise ValueError('Text must have 1 to 4000 characters')
        text.encode('utf-8')
        started=time.perf_counter()
        scores=self.vectors@self.model.encode([text])[0]
        if len(scores)!=len(self.rows) or any(not math.isfinite(float(score)) or not -1<=float(score)<=1 for score in scores):raise ValueError('Invalid similarity score')
        candidates=[dict(id=row['id'],name=row['name'],path=row['path'],source=row['source'],score=round(float(score),6)) for row,score in zip(self.rows,scores)]
        candidates.sort(key=lambda row:row['score'],reverse=True)
        return dict(candidates=candidates,catalogCount=len(self.rows),maxTokens=128,elapsedMs=round((time.perf_counter()-started)*1000,3))


def make_handler(retriever,port=4189):
    Base=handler_for(None,0,port)
    class Handler(Base):
        server_version='LocalAssetSearch/0.1'
        def setup(self):
            super().setup();self.connection.settimeout(10)
        def do_GET(self):
            if not self.allowed():return
            if self.path!='/health':return self.respond(404,{'error':'Not found'})
            return self.respond(200,dict(ok=True,service='local-asset-retrieval',catalogCount=len(retriever.rows),local=True,storesInput=False,sendsInput=False))
        def do_OPTIONS(self):
            if not self.allowed():return
            if self.path not in ('/health','/search'):return self.respond(404,{'error':'Not found'})
            self.send_response(204)
            origin=self.headers.get('Origin')
            if origin:self.send_header('Access-Control-Allow-Origin',origin)
            self.send_header('Access-Control-Allow-Methods','POST, GET, OPTIONS')
            self.send_header('Access-Control-Allow-Headers','Content-Type')
            self.send_header('Content-Length','0');self.end_headers()
        def do_POST(self):
            if not self.allowed():return
            if self.path!='/search':return self.respond(404,{'error':'Not found'})
            if self.headers.get_content_type()!='application/json':return self.respond(415,{'error':'Use application/json'})
            try:
                length=int(self.headers.get('Content-Length','0'))
                if not 0<length<=MAX_BODY:return self.respond(413,{'error':'Request too large or empty'})
                def pairs(items):
                    obj={}
                    for key,value in items:
                        if key in obj:raise ValueError('Duplicate key')
                        obj[key]=value
                    return obj
                data=json.loads(self.rfile.read(length),object_pairs_hook=pairs)
                if type(data) is not dict or set(data)!={'text'}:raise ValueError('Expected text only')
                result=retriever.search(data['text'])
            except (ValueError,UnicodeError,TimeoutError,RecursionError):return self.respond(400,{'error':'Invalid search request'})
            except Exception:return self.respond(500,{'error':'Local asset search failed'})
            return self.respond(200,result)
    return Handler


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--port',type=int,default=4189);args=parser.parse_args()
    if not 1024<=args.port<=65535:parser.error('Invalid port')
    retriever=Retriever(Embeddings(),catalogue())
    server=ThreadingHTTPServer(('127.0.0.1',args.port),make_handler(retriever,args.port))
    def stop(_signal,_frame):raise KeyboardInterrupt
    signal.signal(signal.SIGTERM,stop)
    print(f'Local asset search ready at http://127.0.0.1:{args.port}; {len(retriever.rows)} prepared meshes; input logging disabled',flush=True)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()


if __name__=='__main__':main()
