export interface Quote { price:number;previousClose:number;changePercent:number;volume:number;amount:number;sourceTime:number;stale?:boolean;name:string;source:string }
export interface Instrument {symbol:string;market:'SH'|'SZ';name:string;kind:'stock'|'etf';enabled:number;quote?:Quote|null}
export interface Rule {id:string;symbol:string;market:string;metric:'price'|'change_percent';operator:string;threshold:number;cooldown_seconds:number;daily_limit:number;auto_disable:number;enabled:number;last_triggered_at:number|null;daily_count:number;count_day:string|null}
export interface Notice {id:string;rule_id:string|null;payload:string;created_at:number;status:string;attempts:number;http_status:number|null;last_error:string|null;sent_at:number|null;next_attempt_at:number}
export interface Run {id:string;started_at:number;finished_at:number|null;status:string;quote_count:number;event_count:number;error:string|null}
export interface Status {enabled:boolean;system_enabled:boolean;personal_enabled:boolean;webhook_configured:boolean;runs:Run[];notifications:{status:string;count:number}[]}
export interface Runtime {monitor_enabled:boolean;system_enabled:boolean;webhook_configured:boolean;webhook_host:string;webhook_token_configured:boolean;source:string;interval_seconds:number;max_instruments:number;max_rules:number}
export interface Account {id:string;username:string;nickname:string;created_at:number|string}
