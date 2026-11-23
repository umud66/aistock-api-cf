export interface MonitorEnv {
    DB: D1Database;
    MONITOR_ADMIN_TOKEN?: string;
    MONITOR_ENABLED?: string;
    MONITOR_WEBHOOK_URL?: string;
    MONITOR_WEBHOOK_TOKEN?: string;
    AUTH_PASSWORD_PEPPER?: string;
}
export interface Instrument {
    symbol: string;
    market: 'SH' | 'SZ';
    name: string;
    kind: 'stock' | 'etf';
    enabled: number;
}
export interface Quote {
    symbol: string;
    market: 'SH' | 'SZ';
    name: string;
    price: number;
    previousClose: number;
    changePercent: number;
    volume: number;
    amount: number;
    sourceTime: number;
    source: 'eastmoney';
}
export type Operator = 'above' | 'below' | 'cross_above' | 'cross_below';
export interface Rule {
    id: string;
    symbol: string;
    market: 'SH' | 'SZ';
    metric: 'price' | 'change_percent';
    operator: Operator;
    threshold: number;
    cooldown_seconds: number;
    daily_limit: number;
    auto_disable: number;
    enabled: number;
    previous_value: number | null;
    previous_time: number | null;
    last_triggered_at: number | null;
    count_day: string | null;
    daily_count: number;
}
export interface Evaluation {
    id: string;
    previous_value: number;
    previous_time: number;
    last_triggered_at: number | null;
    count_day: string;
    daily_count: number;
    enabled: number;
    event: null | { id: string; rule_id: string; payload: string; created_at: number };
}
