# 鹿蜀海洋大冒险 · 抓鱼大作战 🐟

一个 3D 无尽跑酷小游戏：**儿子骑着鹿蜀（山海经神兽）在大海里抓鱼**。

- 玩法参考：天天酷跑 / 神庙逃亡
- 三泳道切换、跳跃、下潜躲避障碍
- 抓到鱼有连击、加分、粒子、音效等正反馈
- 鹿蜀奔跑 + 水花飞溅 + 真实海水

## 操作

| 操作 | 键盘 | 手机 |
|------|------|------|
| 切换泳道 | ← → / A D | 左右滑动 |
| 跳跃 | ↑ / W / 空格 | 上滑 |
| 下潜 | ↓ / S | 下滑 |

## 运行

直接托管任意静态服务器即可（无需构建），入口 `index.html`。

```bash
python -m http.server 8000
# 打开 http://localhost:8000
```

## 技术栈

- [Three.js](https://threejs.org/) (r160, CDN import map)
- glTF Transform（纹理压缩 + meshopt 几何压缩）
- 原生 ES Modules，无构建步骤

## 素材来源与授权

| 素材 | 来源 | 授权 |
|------|------|------|
| 儿子骑鹿蜀（玩家角色，原色纹理） | 用户自有 3D 模型 | 个人使用 |
| 河豚 / 蝠鲼 / 鲨鱼 / 灯笼鱼 | [Quaternius](https://quaternius.com/)（经 poly.pizza 的 glTF 版） | CC0（公有领域） |
| 章鱼 | [Octopus by Google (Poly by Google)](https://poly.pizza) | CC-BY 3.0 |
| 石头鱼 | 程序化生成（Three.js 几何体） | 自建 |

> 章鱼模型依据 CC-BY 3.0 要求署名：**"Octopus" by Google (Poly by Google), CC-BY 3.0**。
