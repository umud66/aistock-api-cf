export class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
}
export async function api<T = any>(path: string, method = 'GET', body?: unknown, timeoutMs = 25_000): Promise<T> {
    let response: Response;
    try {
        response = await fetch(path, { method, credentials:'same-origin',
            headers: body === undefined ? {} : {'Content-Type':'application/json'},
            body: body === undefined ? undefined : JSON.stringify(body), signal:AbortSignal.timeout(timeoutMs) });
    } catch {
        throw new ApiError(0,'连接中断或等待超时，请检查网络后重试。');
    }
    let result: {message?:string;data?:T};
    try { result = await response.json(); } catch {throw new ApiError(response.status,'服务返回了无法识别的内容，请稍后重试。');}
    if (!response.ok) throw new ApiError(response.status,result.message || `请求失败（${response.status}）`);
    return result.data as T;
}
