<template id='Display'>
    <div class="row-content background-img min-h-screen bg-neutral-100">
        <div class="py-lg px-lg">
            <h1 class="text-lg font-bold text-neutral-900 mb-lg">Display</h1>

            <div class="flex gap-md mb-lg">
                <Button @click="getOpggPerks" class="btn-secondary">获取符文</Button>
                <Button @click="time" class="btn-primary">确定（测试）</Button>
            </div>

            <!-- Champion Stats Navigation -->
            <div class="bg-primary-100 rounded-md border border-primary-200 p-lg mb-lg">
                <div class="flex gap-md items-center">
                    <Input
                        v-model="championStatsId"
                        placeholder="输入英雄ID"
                        class="w-32"
                        @keyup.enter="goToChampionStats(championStatsId)"
                    />
                    <Button @click="goToChampionStats(championStatsId)" class="btn-primary">
                        查看英雄统计
                    </Button>
                </div>
            </div>

            <!-- 英雄选择监控控制 -->
            <div class="bg-neutral-200 rounded-md p-lg mb-lg">
                <div class="flex gap-md items-center">
                    <Button
                        :class="['transition-all', { 'bg-success-500 hover:bg-success-600': isMonitoring, 'bg-neutral-400 hover:bg-neutral-500': !isMonitoring }]"
                        @click="toggleChampionMonitor"
                    >
                        {{ isMonitoring ? '⏸ 停止监控' : '▶ 启动英雄监控' }}
                    </Button>
                    <span v-if="isMonitoring" class="text-success-600 font-bold text-sm animate-pulse">🔍 监控中...</span>
                </div>
            </div>

            <!-- 胜率浮窗 -->
            <WinrateOverlay ref="winrateOverlay" />

            <!-- 定时截图配置 -->
            <AutoScreenshotConfig ref="autoScreenshotConfig" />
        </div>
    </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { getLolVer } from "../src/service/data-source/lol-qq"
import OpGG from "../src/service/data-source/op-gg"
import LCUService from "../src/service/lcu"
import WinrateOverlay from './WinrateOverlay.vue'
import AutoScreenshotConfig from './AutoScreenshotConfig.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

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
.row-content {
    width: 100%;
    height: 100%;
}

.background-img {
    background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
}
</style>

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
