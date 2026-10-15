import {readFileSync,writeFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {deepStrictEqual} from 'node:assert';
const path='records/凡人修仙传/20261015/168-消息/实际入口记录.json';
const bytes=readFileSync(path),record=JSON.parse(bytes);
const db=new DatabaseSync('.data/凡人输出课堂-20261015/messages.sqlite',{readOnly:true});
const plain=value=>JSON.parse(JSON.stringify(value));
const output={checkedAt:new Date().toISOString(),origin:'重新启动既有4359课堂服务后，独立GET与新的只读SQLite连接核对',modelCalls:0,databaseWrites:0,rawRecordSha256:createHash('sha256').update(bytes).digest('hex'),cases:[]};
try{
 for(const item of record.cases){
  const response=await fetch('http://127.0.0.1:4359/api/messages/conversations/'+item.conversationId);
  const current=await response.json();
  deepStrictEqual(current,item.feedbackReadback);
  const rows=plain(db.prepare('SELECT * FROM messages WHERE conversation_id=? ORDER BY position').all(item.conversationId));
  deepStrictEqual(rows,current.rawRows);
  const conversation=plain(db.prepare('SELECT id,source_record_id,created_at FROM conversations WHERE id=?').get(item.conversationId));
  deepStrictEqual(conversation,{id:current.conversation.id,source_record_id:current.conversation.sourceRecordId,created_at:current.conversation.createdAt});
  if(item.fixtureKey==='normal')deepStrictEqual(item.beforeLock,item.duringLock);
  output.cases.push({fixtureKey:item.fixtureKey,conversationId:item.conversationId,httpStatus:response.status,fullGetMatches:true,fullSqlRowsMatch:true,conversationMatches:true,lockFailureUnchanged:item.fixtureKey==='normal'?true:null,entries:current.entries});
 }
}finally{db.close();}
writeFileSync('records/凡人修仙传/20261015/168-消息/独立保存核对.json',JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify(output));
