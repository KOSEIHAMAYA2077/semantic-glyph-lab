export interface AssetCandidate { id:string; name:string; path:string; source:string; score:number }
export interface AssetSearch { candidates:AssetCandidate[]; catalogCount:number; elapsedMs:number }
export function validateAssetSearch(raw:unknown):AssetSearch {
  if(!raw||typeof raw!=='object')throw new Error('素材検索の応答を確認できませんでした。');
  const data=raw as AssetSearch;
  if(Object.hasOwn(data,'selected')||Object.hasOwn(data,'threshold'))throw new Error('候補以外の自動選択を受け取りました。');
  if(!Array.isArray(data.candidates)||!Number.isInteger(data.catalogCount)||data.catalogCount<1||data.catalogCount>32||data.candidates.length!==data.catalogCount||!Number.isFinite(data.elapsedMs)||data.elapsedMs<0)throw new Error('素材検索の応答を確認できませんでした。');
  const ids=new Set();
  for(const candidate of data.candidates) {
    if(!candidate||typeof candidate.id!=='string'||!/^[a-z0-9_-]{1,80}$/.test(candidate.id)||ids.has(candidate.id)||typeof candidate.name!=='string'||!candidate.name.trim()||candidate.name.length>200||typeof candidate.path!=='string'||!/^\/retrieval-models\/[a-zA-Z0-9_.-]+\.glb$/.test(candidate.path)||candidate.path.includes('..')||typeof candidate.source!=='string'||!/^https:\/\/polyhaven\.com\/a\/[a-z0-9_-]+$/.test(candidate.source)||!Number.isFinite(candidate.score)||candidate.score<-1||candidate.score>1)throw new Error('素材の指定を確認できませんでした。');
    ids.add(candidate.id);
  }
  return data;
}
