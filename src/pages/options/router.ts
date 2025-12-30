import {createRouter, createWebHistory} from "vue-router";

import AppOptions from "./AppOptions.vue";
import AppProviderTypes from "./AppProviderTypes.vue";

const routes = [
    {path: "/", component: AppOptions},
    {path: "/provider-types", component: AppProviderTypes}
]

const router = createRouter({
    history: createWebHistory(),
    routes
})

export default router
