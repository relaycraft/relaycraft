/**
 * RelayCraft 类型定义
 *
 * 设计原则：
 * 1. 完全兼容 HAR 1.2 标准
 * 2. 扩展字段使用 `_rc` 命名空间避免冲突
 * 3. 支持内存优化（FlowIndex + FlowDetail 分离）
 */

// ==================== HAR 标准类型 ====================
export {
  type Flow,
  type FlowDetail,
  type FlowIndex,
  type FlowIndexHit,
  // 核心结构
  type FlowRequest,
  type FlowResponse,
  getHeaderValue,
  getHeaderValues,
  getQueryValue,
  getQueryValues,
  type HarContent,
  type HarCookie,
  type HarHeader,
  type HarPostData,
  type HarQueryString,
  type HarTimings,
  harToLegacyHeaders,
  isHarHeaders,
  isLegacyHeaders,
  // 兼容性工具
  type LegacyHeaders,
  legacyToHarHeaders,
  type RcError,
  type RcExtension,
  type RcIntercept,
  // RelayCraft 扩展类型
  type RcMatchedHit,
  type RcParsedUrl,
  type RcWebSocketFrame,
} from "./flow";

// ==================== Rules 类型 ====================
export * from "./rules";
