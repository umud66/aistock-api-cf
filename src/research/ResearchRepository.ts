import type {ResearchAnalysis} from './types';

export class ResearchRepository {
    constructor(private db:D1Database,private userId:string){}
    async latest(symbol:string):Promise<ResearchAnalysis|null> {
        const row=await this.db.prepare('SELECT * FROM user_market_analyses WHERE user_id=? AND symbol=?').bind(this.userId,symbol)
            .first<{symbol:string;model:string;report:string;evidence:string;created_at:number}>();
        return row?{symbol:row.symbol,model:row.model,report:JSON.parse(row.report),evidence:JSON.parse(row.evidence),createdAt:row.created_at}:null;
    }
    async acquire(symbol:string,owner:string):Promise<boolean> {
        const now=Date.now();
        return !!await this.db.prepare(`INSERT INTO user_analysis_locks(user_id,symbol,owner,expires_at) VALUES(?,?,?,?)
            ON CONFLICT(user_id,symbol) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at
            WHERE user_analysis_locks.expires_at<=? RETURNING owner`).bind(this.userId,symbol,owner,now+120_000,now).first();
    }
    async save(value:ResearchAnalysis,owner:string):Promise<void> {
        const result=await this.db.prepare(`INSERT INTO user_market_analyses(user_id,symbol,model,report,evidence,created_at)
            SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM user_analysis_locks WHERE user_id=? AND symbol=? AND owner=? AND expires_at>?)
            ON CONFLICT(user_id,symbol) DO UPDATE SET model=excluded.model,report=excluded.report,evidence=excluded.evidence,created_at=excluded.created_at
            RETURNING symbol`).bind(this.userId,value.symbol,value.model,JSON.stringify(value.report),JSON.stringify(value.evidence),value.createdAt,this.userId,value.symbol,owner,Date.now()).first();
        if(!result)throw new Error('分析生成租约已过期，请重新生成');
    }
    async release(symbol:string,owner:string):Promise<void> {
        await this.db.prepare('DELETE FROM user_analysis_locks WHERE user_id=? AND symbol=? AND owner=?').bind(this.userId,symbol,owner).run();
    }
}
