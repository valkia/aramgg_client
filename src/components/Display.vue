<template id='Display'>
    <div class="row-content background-img">
        <el-row>Display</el-row>
        <button @click="getOpggPerks">获取符文</button>
        <button @click="time">确定（测试）</button>

        <!-- Champion Stats Navigation -->
        <div class="champion-stats-control">
            <el-input
                v-model="championStatsId"
                placeholder="输入英雄ID"
                style="width: 150px"
                @keyup.enter="goToChampionStats(championStatsId)"
            />
            <button @click="goToChampionStats(championStatsId)" class="stats-btn">
                查看英雄统计
            </button>
        </div>

        <!-- 英雄选择监控控制 -->
        <div class="champion-monitor-control">
            <button
                :class="['monitor-btn', { active: isMonitoring }]"
                @click="toggleChampionMonitor"
            >
                {{ isMonitoring ? '⏸ 停止监控' : '▶ 启动英雄监控' }}
            </button>
            <span v-if="isMonitoring" class="monitor-status">🔍 监控中...</span>
        </div>

        <!-- 胜率浮窗 -->
        <WinrateOverlay ref="winrateOverlay" />

        <!-- 定时截图配置 -->
        <AutoScreenshotConfig ref="autoScreenshotConfig" />
    </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import {getLolVer} from "../src/service/data-source/lol-qq";
import OpGG from "../src/service/data-source/op-gg";
import LCUService from "../src/service/lcu";
import WinrateOverlay from './WinrateOverlay.vue'
import AutoScreenshotConfig from './AutoScreenshotConfig.vue'

// Use pre-loaded PromisePool from preload
const PromisePool = window.PromisePool || null;

const router = useRouter();
const ipcRenderer = window.electron?.ipcRenderer;
const winrateOverlay = ref(null);
const autoScreenshotConfig = ref(null);
const isMonitoring = ref(false);
const championStatsId = ref('1'); // Default to champion ID 1

// Navigate to champion stats page
const goToChampionStats = (championId) => {
    if (!championId) {
        alert('请输入英雄ID');
        return;
    }
    router.push({ name: 'ChampionStats', params: { id: championId } });
}

const getOpggPerks = async () => {
    const lolDir = "D:\\Program Files (x86)\\WeGameApps\\英雄联盟";
    const lolVer = await getLolVer();
    console.log(`lolVer${lolVer}`);
    const instance = new OpGG(lolVer, lolDir);

    let opggTask = () =>
        instance
            .import()
            .then(() => {
                console.log("[OP.GG] completed");
            })
            .catch((err) => {
                console.log("err:" + err);
                if (err.message === `Error: Cancel`) {
                    console.log(`Error: Cancel`);
                }
            });

    console.log(opggTask());
    try {
        // Create a pool.
        var pool = new PromisePool(opggTask(), 3);

        // Start the pool.
        var poolPromise = pool.start();

        // Wait for the pool to settle.
        poolPromise.then(
            function (values) {
                console.log("All promises fulfilled");
                console.log(`values:${values}`);
            },
            function (error) {
                console.log("Some promise rejected: " + error.message);
            }
        );
    } catch (e) {
        console.log(`Promise.all e:${e}`);
    } finally {
        console.log("finish");
    }
}

const findUserChampion = (cellId, actions = []) => {
    let id = 0;
    console.log(cellId);
    console.log(actions);
    if (!actions || !actions.length) return id;

    for (const action of actions) {
        for (const cell of action) {
            if (
                cell.actorCellId === cellId &&
                ["pick"].includes(cell.type)
            ) {
                id = cell.championId;
                break;
            }
        }
    }

    return id;
}

// 英雄选择监控定时器
let championMonitorInterval = null;

/**
 * 启动英雄选择监控
 */
const startChampionMonitor = () => {
    if (championMonitorInterval) {
        console.log('Champion monitor already running');
        return;
    }

    console.log('🚀 Starting champion monitor...');
    console.log('📋 需要确保:');
    console.log('  1. ✓ LOL 客户端已启动');
    console.log('  2. ✓ 已进入游戏客户端');
    console.log('  3. ✓ 正在选人阶段（排位/普通/自定义等）');

    isMonitoring.value = true;

    championMonitorInterval = setInterval(async () => {
        try {
            // 获取真实的英雄选择
            const championId = await getChampionId();

            if (!championId) {
                // 静默处理：继续等待选择
                return;
            }

            console.log(`✅ Got champion id: ${championId}`);

            // 发送显示符文弹窗的事件
            ipcRenderer?.send(`show-popup`, {
                championId,
                position: null,
            });

            console.log(`📋 Showing rune popup for champion ${championId}`);
        } catch (err) {
            // 静默处理错误，持续监控
            console.debug(`[Champion Monitor] Error:`, err.message);
        }
    }, 2000); // 每2秒检查一次
}

/**
 * 停止英雄选择监控
 */
const stopChampionMonitor = () => {
    if (championMonitorInterval) {
        clearInterval(championMonitorInterval);
        championMonitorInterval = null;
        isMonitoring.value = false;
        console.log('⏸ Champion monitor stopped');
    }
}

/**
 * 切换英雄选择监控
 */
const toggleChampionMonitor = () => {
    if (isMonitoring.value) {
        stopChampionMonitor();
    } else {
        startChampionMonitor();
    }
}

/**
 * 旧的 time() 函数（保留兼容性）
 */
const time = () => {
    let interval = setInterval(async () => {
        console.log(`setInterval`);
        try {
            //let championId = await getChampionId();
            let championId = 202;

            if (!championId) {
                console.log(`no matched.`);
                throw new Error(`no active session.`);
            }

            console.log(`got champion id: `, championId);
            ipcRenderer?.send(`show-popup`, {
                championId,
                position: null,
            });
            clearInterval(interval);
            console.log(`show popup.`);
            return true;
        } catch (_err) {
            if (process.env.IS_DEV) return;

            console.error(`cannot show popup.`);
            ipcRenderer?.send(`hide-popup`);
        }
    }, 1600);
}

const getChampionId = async () => {
    // TODO: 从配置中获取 LOL 路径，而不是硬编码
    //const lolDir = "D:\\Program Files (x86)\\WeGameApps\\英雄联盟";
    const lolDir = "E:\\wegame\\英雄联盟(26)";

    if (!lolDir) {
        console.error(`❌ lol folder not selected.`);
        return false;
    }

    console.log(`[getChampionId] LOL Dir: ${lolDir}`);
    const lcuIns = new LCUService(lolDir);

    try {
        console.log(`[getChampionId] Getting auth token...`);
        const [token, port, url] = await lcuIns.getAuthToken();

        console.log(`[getChampionId] Token valid: ${!!token}`);
        console.log(`[getChampionId] LCU Active: ${lcuIns.active}`);

        if (!token || !lcuIns.active) {
            console.warn(`⚠️ LCU not connected - 需要确保:`);
            console.warn(`  1. LOL 客户端已启动`);
            console.warn(`  2. 已进入游戏客户端主界面`);
            console.warn(`  3. 进入排位/普通/自定义等游戏模式的选人阶段`);
            return false;
        }

        console.log(`[getChampionId] Getting current session...`);
        const {
            actions = [],
            myTeam = [],
            localPlayerCellId: cellId,
        } = await lcuIns.getCurrentSession();

        console.log(`[getChampionId] Session data:`, {
            cellId,
            myTeam: myTeam.length,
            actions: actions.length,
        });

        const me =
            myTeam.find((i) => i.summonerId > 0 && i.cellId === cellId) || {};
        const {championId: mChampionId} = me;
        let championId;

        const isRandomMode =
            !actions.length && myTeam.length > 0 && mChampionId > 0;
        const isVoteMode =
            mChampionId > 0 &&
            myTeam.length > 0 &&
            myTeam.every((i) => i.championId === mChampionId);

        championId = findUserChampion(cellId, actions);

        console.log(
            `[getChampionId] Mode - Random: ${isRandomMode}, Vote: ${isVoteMode}, Champion: ${championId}`
        );

        if (isRandomMode || isVoteMode) {
            championId = me.championId;
        }

        if (championId) {
            console.log(`✅ Found champion: ${championId}`);
        }

        return championId;
    } catch (error) {
        console.error(`❌ Error getting champion id:`, error.message);
        console.error(`  详细信息:`, error);
        return false;
    }
}

const init = () => {
    // 自动启动英雄选择轮询
    startChampionMonitor();
}

onMounted(() => {
    console.log("display mounted");
    init();
});

onBeforeUnmount(() => {
    console.log("display unmounting, stopping champion monitor");
    stopChampionMonitor();
});
</script>

<style scoped>
.champion-stats-control {
    margin: 16px 0;
    padding: 12px;
    background-color: #e3f2fd;
    border-radius: 8px;
    display: flex;
    align-items: center;
    gap: 12px;
}

.stats-btn {
    padding: 10px 16px;
    background-color: #2196f3;
    border: none;
    border-radius: 6px;
    color: white;
    font-weight: bold;
    cursor: pointer;
    transition: all 0.2s;
    font-size: 14px;
}

.stats-btn:hover {
    background-color: #1976d2;
    transform: translateY(-2px);
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
}

.champion-monitor-control {
    margin: 16px 0;
    padding: 12px;
    background-color: #f5f5f5;
    border-radius: 8px;
    display: flex;
    align-items: center;
    gap: 12px;
}

.monitor-btn {
    padding: 10px 16px;
    background-color: #999;
    border: none;
    border-radius: 6px;
    color: white;
    font-weight: bold;
    cursor: pointer;
    transition: all 0.2s;
    font-size: 14px;
}

.monitor-btn:hover {
    background-color: #777;
    transform: translateY(-2px);
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
}

.monitor-btn.active {
    background-color: #27ae60;
}

.monitor-btn.active:hover {
    background-color: #229954;
}

.monitor-status {
    color: #27ae60;
    font-weight: bold;
    font-size: 13px;
    animation: blink 2s infinite;
}

@keyframes blink {
    0%, 50%, 100% {
        opacity: 1;
    }
    25%, 75% {
        opacity: 0.5;
    }
}
</style>