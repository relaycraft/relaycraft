/**
 * Flow - RelayCraft 核心数据结构
 *
 * 设计原则：
 * 1. 完全兼容 HAR 1.2 标准
 * 2. 扩展字段使用 `_rc` 命名空间避免冲突
 * 3. 支持内存优化（FlowIndex + FlowDetail 分离）
 * 4. 面向未来扩展
 *
 * @see https://w3c.github.io/web-performance/specs/HAR/Overview.html
 */

// ==================== HAR 1.2 标准类型 ====================

/**
 * HAR 标准头部
 * @note 使用数组格式支持同名 header 多次出现（如 Set-Cookie）
 */
export interface HarHeader {
  name: string;
  value: string;
  comment?: string;
}

/**
 * HAR 标准 Cookie
 */
export interface HarCookie {
  name: string;
  value: string;
  path?: string;
  domain?: string;
  expires?: string;
  httpOnly?: boolean;
  secure?: boolean;
  comment?: string;
}

/**
 * HAR 标准 QueryString
 */
export interface HarQueryString {
  name: string;
  value: string;
  comment?: string;
}

/**
 * HAR 标准 PostData
 */
export interface HarPostData {
  mimeType: string;
  text?: string;
  params?: Array<{
    name: string;
    value?: string;
    fileName?: string;
    contentType?: string;
    comment?: string;
  }>;
  comment?: string;
}

/**
 * HAR 标准 Content
 */
export interface HarContent {
  size: number;
  mimeType: string;
  text?: string;
  encoding?: "text" | "base64" | "base64url";
  compression?: number;
  comment?: string;
}

/**
 * HAR 标准 Timings (毫秒)
 * @note 所有值都是可选的，-1 表示不适用
 */
export interface HarTimings {
  blocked?: number;
  dns?: number;
  connect?: number;
  ssl?: number;
  send?: number;
  wait?: number;
  receive?: number;
  comment?: string;
}

// ==================== RelayCraft 扩展类型 ====================

/**
 * RelayCraft 扩展 - 匹配命中
 */
export interface RcMatchedHit {
  id: string;
  name: string;
  type: "rule" | "script" | "breakpoint" | string;
  status?: "success" | "warning" | "error" | "file_not_found";
  message?: string;
  timestamp?: number;
}

/**
 * RelayCraft 扩展 - WebSocket 帧
 * @note 包含 id 和 flowId 支持分页和独立存储
 */
export interface RcWebSocketFrame {
  id: string;
  flowId: string;
  seq: number; // 帧序号，用于排序
  type: "text" | "binary" | "ping" | "pong" | "close";
  fromClient: boolean;
  content: string;
  encoding?: "text" | "base64";
  timestamp: number;
  length: number;
}

/**
 * RelayCraft 扩展 - 拦截状态
 */
export interface RcIntercept {
  intercepted: boolean;
  phase?: "request" | "response";
  modifiedAt?: number;
}

/**
 * RelayCraft 扩展 - 错误详情
 */
export interface RcError {
  message: string;
  type: "network" | "tls" | "timeout" | "protocol" | "unknown";
  code?: string;
  stack?: string;
}

/**
 * RelayCraft 扩展 - 解析后的 URL
 */
export interface RcParsedUrl {
  scheme: string;
  host: string;
  port?: number;
  path: string;
  query: string;
  fragment?: string;
}

// ==================== 核心结构 ====================

/**
 * 请求信息
 */
export interface FlowRequest {
  method: string;
  url: string;
  httpVersion: string;

  // HAR 标准数组格式（支持多值）
  headers: HarHeader[];
  cookies: HarCookie[];
  queryString: HarQueryString[];

  // Body
  postData?: HarPostData;
  bodySize: number;
  headersSize: number;

  // RelayCraft 扩展
  _parsedUrl?: RcParsedUrl;
}

/**
 * 响应信息
 */
export interface FlowResponse {
  status: number;
  statusText: string;
  httpVersion: string;

  // HAR 标准数组格式（支持多值）
  headers: HarHeader[];
  cookies: HarCookie[];

  // Body
  content: HarContent;
  headersSize: number;
  bodySize: number;

  // 重定向
  redirectUrl: string;
}

/**
 * RelayCraft 扩展命名空间
 * @note 使用 `_rc` 前缀避免与未来 HAR 版本冲突
 */
export interface RcExtension {
  // 元信息
  clientIp?: string;
  serverIp?: string;
  error?: RcError;

  // WebSocket
  isWebsocket: boolean;
  websocketFrameCount: number;

  // 匹配
  hits: RcMatchedHit[];

  // 拦截
  intercept: RcIntercept;

  // 标记
  bodyTruncated: boolean;

  // 未来扩展预留
  [key: string]: unknown;
}

/**
 * 完整 Flow 结构
 * @description 单个 HTTP 请求/响应的完整记录
 */
export interface Flow {
  // ========== 标识 ==========
  id: string;
  seq: number; // 自增序列号，用于默认排序

  // ========== HAR 标准字段 ==========
  startedDateTime: string; // ISO 8601 格式
  time: number; // 总耗时 ms

  request: FlowRequest;
  response: FlowResponse;

  timings: HarTimings;
  cache: Record<string, unknown>; // HAR 要求，可为空对象

  // ========== RelayCraft 扩展 ==========
  _rc: RcExtension;
}

// ==================== 内存优化层 ====================

/**
 * 流量索引 - 轻量级元数据
 * @description 用于列表展示，始终在内存中
 * @size ~200 bytes per entry
 */
export interface FlowIndex {
  id: string;
  seq: number; // 自增序列号，用于默认排序

  // 请求摘要
  method: string;
  url: string;
  host: string;
  path: string;

  // 响应摘要
  status: number;
  contentType: string;

  // 元信息
  startedDateTime: string;
  time: number;
  size: number;

  // 标记
  hasError: boolean;
  hasRequestBody: boolean;
  hasResponseBody: boolean;
  isWebsocket: boolean;
  websocketFrameCount: number;
  hitCount: number;
}

/**
 * 流量详情 - 完整数据
 * @description 按需加载，存入 SQLite
 */
export interface FlowDetail {
  id: string;

  // 完整请求/响应
  request: FlowRequest;
  response: FlowResponse;
  timings: HarTimings;

  // WebSocket 帧（分页）
  websocketFrames?: RcWebSocketFrame[];

  // 扩展
  _rc: RcExtension;
}

// ==================== 兼容性工具 ====================

/**
 * 旧版 Header 格式（Record）
 * @deprecated 仅用于兼容旧数据
 */
export type LegacyHeaders = Record<string, string>;

/**
 * 将旧版 Headers 转换为 HAR 格式
 */
export function legacyToHarHeaders(headers: LegacyHeaders): HarHeader[] {
  return Object.entries(headers).map(([name, value]) => ({
    name,
    value,
  }));
}

/**
 * 将 HAR Headers 转换为旧版格式
 * @warning 同名 header 会被覆盖
 */
export function harToLegacyHeaders(headers: HarHeader[]): LegacyHeaders {
  const result: LegacyHeaders = {};
  headers.forEach((h) => {
    result[h.name] = h.value;
  });
  return result;
}

/**
 * 获取所有同名 header 的值
 */
export function getHeaderValues(headers: HarHeader[], name: string): string[] {
  const lowerName = name.toLowerCase();
  return headers.filter((h) => h.name.toLowerCase() === lowerName).map((h) => h.value);
}

/**
 * 获取单个 header 值（第一个）
 */
export function getHeaderValue(headers: HarHeader[], name: string): string | undefined {
  return getHeaderValues(headers, name)[0];
}

/**
 * 获取所有同名 query 参数的值
 */
export function getQueryValues(queryString: HarQueryString[], name: string): string[] {
  const lowerName = name.toLowerCase();
  return queryString.filter((q) => q.name.toLowerCase() === lowerName).map((q) => q.value);
}

/**
 * 获取单个 query 参数值（第一个）
 */
export function getQueryValue(queryString: HarQueryString[], name: string): string | undefined {
  return getQueryValues(queryString, name)[0];
}

// ==================== 类型守卫 ====================

/**
 * 检查是否为 HAR 格式 Headers
 */
export function isHarHeaders(headers: HarHeader[] | LegacyHeaders): headers is HarHeader[] {
  return Array.isArray(headers) && (headers.length === 0 || "name" in headers[0]);
}

/**
 * 检查是否为旧版格式 Headers
 */
export function isLegacyHeaders(headers: HarHeader[] | LegacyHeaders): headers is LegacyHeaders {
  return !Array.isArray(headers);
}
