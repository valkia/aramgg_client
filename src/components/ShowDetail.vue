<template id='ShowDetail'>
    <div class="row-content background-img">
        <el-row>{{championDetail.name}} - {{championDetail.title}}</el-row>
        <el-row>
            <el-col :span="12">
                <div @click="selectType('opgg')">opgg</div>
            </el-col>
            <el-col :span="12">
                <div @click="selectType('qq')">qq</div>
            </el-col>
        </el-row>

        <el-row class="title-row">
            <el-col :span="3"></el-col>
            <el-col :span="6">位置</el-col>
            <el-col :span="6">胜率</el-col>
            <el-col :span="6">选择次数</el-col>
        </el-row>
        <div v-show="type==='qq'">
            <div v-for="(perk ,index) in qqPerks" :key="index">
                <el-row class="perk-row" type="flex" @mouseenter="showPreview(perk)" @mouseleave="hidePreview">
                    <el-col :span="3" class="perk-img-content"><img class="perk-img"
                                                                    :src="'/runes/'+perk.selectedPerkIds[0]+'.png'">
                    </el-col>
                    <el-col :span="6">{{perk.position}}</el-col>
                    <el-col :span="6">{{perk.winRate}}%</el-col>
                    <el-col :span="6">{{perk.pickCount}}</el-col>
                    <el-col :span="3">
                        <div @click="apply(perk)">应用</div>
                    </el-col>
                </el-row>
            </div>
        </div>


        <div v-show="type==='opgg'">
            <div v-for="(perk ,index) in opggPerks" :key="index">
                <el-row class="perk-row" type="flex" @mouseenter="showPreview(perk)" @mouseleave="hidePreview">
                    <el-col :span="3" class="perk-img-content"><img class="perk-img"
                                                                    :src="'/runes/'+perk.selectedPerkIds[0]+'.png'">
                    </el-col>
                    <el-col :span="6">{{perk.position}}</el-col>
                    <el-col :span="6">{{perk.winRate}}%</el-col>
                    <el-col :span="6">{{perk.pickCount}}</el-col>
                    <el-col :span="3">
                        <div @click="apply(perk)">应用</div>
                    </el-col>
                </el-row>
            </div>
        </div>


    </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import config from "../src/native/config";
import {QQChampionAvatarPrefix, getChampions} from '../src/service/qq';
import LCUService from '../src/service/lcu';
import LolQQ from '../src/service/data-source/lol-qq';
import Opgg from '../src/service/data-source/op-gg';
import {getChampionInfo} from './utils';

const type = ref("opgg");
const championId = ref("");
const championDetail = ref({});
const championMap = ref([]);
const qqPerks = ref([]);
const opggPerks = ref([]);
const curPerk = ref({});
const coordinate = ref({x: 0, y: 0, width: 0, height: 0});

const ipcRenderer = window.electron?.ipcRenderer;

const selectType = (typeValue) => {
    type.value = typeValue;
}

const init = async () => {
    const lolVer = config.get(`lolVer`);
    const championList = await getChampions(lolVer);
    championMap.value = championList;
    console.log(championList)

    ipcRenderer?.on('for-popup', (event, {championId: id}) => {
        if (id) {
            championId.value = id;
            console.log(`id:${id}`);

            if (!championId.value || !championMap.value) return;

            const champ = getChampionInfo(championId.value, championMap.value);
            if (!champ) {
                championId.value = 0;
                championDetail.value = null;
                return;
            }

            championDetail.value = champ;
            console.log(champ.key)
            console.log(champ.id)
            console.log(championDetail.value)
            const lolqqInstance = new LolQQ();
            lolqqInstance.getChampionPerks(champ.key, champ.id).then((result) => {
                qqPerks.value = (result);
                console.log(qqPerks.value)
            });

            const opggInstance = new Opgg();
            opggInstance.getChampionPerks(champ.id).then((result) => {
                opggPerks.value = (result);
                console.log(result)
            });
        }
    });
}

const apply = async (perk) => {
    console.log("apply");
    const lolVer = config.get(`lolVer`);
    const lolDir = config.get(`lolDir`);
    console.log(`lolVer:${lolVer}`);
    console.log(`lolDir:${lolDir}`);

    try {
        const lcuInstance = new LCUService(lolDir);
        await lcuInstance.getAuthToken();
        const res = await lcuInstance.applyPerk({
            ...perk,
        });
        console.info(`Apply perk`, res);
    } catch (e) {
        console.error(e);
    }
}

const showPreview = (perk, el) => {
    console.log("showPreview");
    curPerk.value = perk;
    if (!el) return;

    const {x, y, width, height} = el.getBoundingClientRect();
    coordinate.value = {x, y, width, height};
}

const hidePreview = () => {
    console.log("hidePreview");
    curPerk.value = {};
}

onMounted(() => {
    console.log("ShowDetail");
    config.set(`test`, `zh-CN`);
    console.log(config.get(`test`));
    const lolDir = config.get(`lolDir`);
    init();
});
</script>

<style>

    .title-row {
        height: 30px;
        line-height: 30px;
    }

    .perk-row {
        height: 50px;
        align-items: center;
        line-height: 50px;
    }

    .perk-img {
        height: 30px;
    }

    .perk-img-content {
        justify-content: center;
        align-items: center;
        display: flex;
    }
</style>