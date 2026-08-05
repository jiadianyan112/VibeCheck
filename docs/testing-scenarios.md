# VibeCheck 固定异常场景打开方式

先双击项目根目录的 `打开VibeCheck原型.cmd`，或运行：

```powershell
npm run dev -- --host 127.0.0.1 --port 4173
```

登录测试身份后，在下列地址追加 `scenario` 参数。页面输入会保存在本地原型状态中；切回 `scenario=default` 可重试成功。

| 链路 | 打开方式 | 预期错误／状态 |
| --- | --- | --- |
| 发布 URL 网络中断 | `/submit?scenario=network_error` | `VC_NETWORK_UNAVAILABLE`，URL 保留 |
| 发布 URL 服务失败 | `/submit?scenario=service_error` | `VC_SERVICE_UNAVAILABLE`，可原位重试 |
| 发布 URL 首次超时 | `/submit?scenario=timeout` | 访问检查 warning，可保存不可直接继续 |
| 自动提取部分失败 | 调试面板选 `extraction_partial` 后进入 `/submit/new?...&step=prefill` | 已提取字段保留，失败字段可手填 |
| 外链风险 | `/submit?scenario=external_link_risk` | 安全检查失败，不创建审核单 |
| 发布审核异常 | `/submit/new?draft=<draftId>&step=preview&scenario=service_error` | `VC_SERVICE_UNAVAILABLE`，提交版本不变 |
| 身份审核异常 | `/project/project-pdfquizlab/verify-author?scenario=service_error` | 私有材料草稿保留，可重试 |
| 身份归属争议 | `/project/project-pdfquizlab/verify-author?scenario=verification_disputed` | 高风险编辑冻结 |
| 更新网络中断 | `/project/project-speakmirror/update?type=address&scenario=network_error` | 更新草稿与前后值保留 |
| 更新服务失败 | `/project/project-speakmirror/update?type=version&scenario=service_error` | `VC_SERVICE_UNAVAILABLE`，不写事件 |
| 更新权限失效 | `/project/project-speakmirror/update?type=version&scenario=permission_expired` | `VC_UPDATE_PERMISSION_EXPIRED`，引导重新验证 |

审核固定结果还可使用 `review_changes_requested`、`review_approved`、`review_rejected`；作者身份争议使用 `verification_disputed`。所有技术错误都可展开“查看技术信息”读取稳定错误 code。
