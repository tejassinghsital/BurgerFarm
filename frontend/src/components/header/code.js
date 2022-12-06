import async from "async";
import moment from "moment";
import Review from "../models/review";
import Device from "../models/device";
import Session from "../models/session";
import deviceService from "./device.service";
import groupBy from "../utils/groupBy";
import { Parser } from "json2csv";
import { Constants } from "../utils/Constants";
import planogramEditorServices from "./planogramEditor.service";

// Method to get session review
const getReview = async (sessionId, deviceId) => {
    try {
        let doc = await Review.findOne({
            session_id: sessionId,
        });
        if (doc) {
            return doc;
        } else {
            return false;
        }
    } catch (error) {
        return error.message;
    }
};

// Method to add new session  review  document
const createReview = async (body, deviceId) => {
    try {
        const shelves = await reduceShelves(body);
        const results = await calcAccuracy(shelves, deviceId);
        body.accuracy = results;
        body.created_at = Date.now();
        body.updated_at = Date.now();
        const doc = new Review(body);
        const response = await doc.save();
        if (response) {
            return response;
        } else {
            return false;
        }
    } catch (error) {
        return error.message;
    }
};

// Method to update session review document
const updateReview = async (sessionId, deviceId, data) => {
    try {
        // console.log("data",data)
        const shelves = await reduceShelves(data);
        if (shelves != null) {
            const results = await calcAccuracy(shelves, deviceId);
            data.accuracy = results;
        }
        let planogram;
        data.created_at = Date.now();
        data.updated_at = Date.now();

        const session = await Session.findOne(
            {
                session_id: sessionId,
            },
            {
                model: 1,
            }
        );

        const device = await Device.findOne(
            {
                device_id: deviceId,
            },
            {
                "planogram.category": 1,
            }
        );

        const planogramRes = await planogramEditorServices.getPlanogram(deviceId);
        if (planogramRes) {
            planogram = await planogramEditorServices.generatePlanogramJSON(
                deviceId,
                planogramRes
            );
        }

        let review = await Review.findOne({
            device_id: deviceId,
            session_id: sessionId,
        });
        // console.log("review",review);

        let response;
        // console.log("rev",review)
        if (review != null) {
            const { instock_acc, oos_acc, correct_oos } =
                calcInstockAndOOSAccuracy(review);
            data.instock_accuracy = instock_acc;
            data.oos_accuracy = oos_acc;
            data.oos_items_count = correct_oos;
            data.instock_items_count = data.planogram_items_count - correct_oos;
            data.category = planogram.category;
            data.review_timestamp = new Date().getTime();
            data.cooler_reviews = data.cooler_reviews;

            // update new review
            response = await Review.update(
                {
                    device_id: deviceId,
                    session_id: sessionId,
                },
                { $set: data }
            );

            console.log("review update");

            review = await Review.findOne({
                device_id: deviceId,
                session_id: sessionId,
            });
            return response ? review : false;
        } else {
            const { instock_acc, oos_acc, correct_oos } =
                calcInstockAndOOSAccuracy(data);
            // create new review
            const doc = new Review({
                ...data,
                device_id: deviceId,
                session_id: sessionId,
                category: device.planogram.category,
                shelf_model:
                    session.model.shelf.category + "." + session.model.shelf.version,
                object_model:
                    session.model.object.category + "." + session.model.object.version,
                classification_model:
                    session.model.oos_classification.category +
                    "." +
                    session.model.oos_classification.version,
                oos_items_count: correct_oos,
                instock_items_count: data.planogram_items_count - correct_oos,
                instock_accuracy: instock_acc,
                oos_accuracy: oos_acc,
                cooler_reviews: data.cooler_reviews,
            });
            // console.log("this is the final doc",doc)
            response = await doc.save();

            return response;
        }
    } catch (error) {
        console.log("-----error---", error);
        return error.message;
    }
};

const getReviewsForReport = async (query) => {
    try {
        let docs = await Review.find(query);
        if (docs) {
            return docs;
        } else {
            return false;
        }
    } catch (error) {
        return error.message;
    }
};

const getOOSReviews = async (query) => {
    try {
        let docs = await Review.aggregate(query);
        if (docs) {
            return docs;
        } else {
            return false;
        }
    } catch (error) {
        return error.message;
    }
};

const getReviewsForSummaryReport = async (query, category = null) => {
    let conditions = [
        {
            $match: query,
        },

        {
            $lookup: {
                from: "devices",
                localField: "device_id",
                foreignField: "device_id",
                as: "device",
            },
        },

        {
            $unwind: {
                path: "$device",
                preserveNullAndEmptyArrays: true,
            },
        },
        {
            $project: {
                session_id: "$session_id",
                created_at: "$created_at",
                updated_at: "$updated_at",
                oos_reviews: "$oos_reviews",
                device_id: "$device_id",
                planogram_items_count: "$planogram_items_count",
                detected_items_count: "$detected_items_count",
                shelves_wrongly_detected: "$shelves_wrongly_detected",
                oos_automation: "$device.oos_automation",
                category: "$device.planogram.category",
            },
        },
    ];
    if (category) {
        conditions.push({
            $match: {
                category: { $eq: category },
            },
        });
    }
    try {
        let doc = await Review.aggregate(conditions);
        return doc;
    } catch (err) {
        console.log("-------error while find review --------", err.message);
        return [];
    }
};

const getSessionsForSummaryReport = async (query, category = null) => {
    query["oos_review_status"] = { $ne: "NOT_STARTED" };
    try {
        let doc = await Session.find(query, {
            session_id: 1,
            created_at: 1,
            updated_at: 1,
            device_id: 1,
            "oos_results.session_start_time": 1,
        });
        return doc;
    } catch (err) {
        let devices = await Device.find({ device_id: query.device_id });
        let device_ids = devices.map((device) => device.device_id);
        let sessions = [];
        for (let i = 0; i < device_ids.length; i++) {
            let doc = await Session.find(
                {
                    device_id: device_ids[i],
                    "oos_results.session_start_time": {
                        $gte: query["oos_results.session_start_time"].$gte,
                        $lte: query["oos_results.session_start_time"].$lte,
                    },
                    oos_review_status: { $ne: "NOT_STARTED" },
                },
                {
                    session_id: 1,
                    created_at: 1,
                    updated_at: 1,
                    device_id: 1,
                    "oos_results.session_start_time": 1,
                }
            );
            sessions.push(...doc);
        }
        return sessions;
    }
};

const getReviewsForSummaryReportV2 = async (query, category = null) => {
    try {
        if (category) {
            query["category"] = category;
        }
        console.log("querrrryyy", query);
        query["created_at"]["$lte"] = moment(new Date(query["created_at"]["$lte"]))
            .add(1, "day")
            .format("YYYY-MM-DD");
        let doc = await Review.find(query, {
            accuracy: 1,
            created_at: 1,
            updated_at: 1,
            device_id: 1,
            oos_accuracy: 1,
            instock_accuracy: 1,
            category: 1,
            session_id: 1,
            review_timestamp: 1,
        });
        return doc;
    } catch (err) {
        console.log("serive report error", err);
    }
};

const getRecentFiveSessionsForSummaryReport = async (
    query,
    category = null
) => {
    query["status"] = "Completed";
    try {
        let doc = await Session.find(query, {
            session_id: 1,
            created_at: 1,
            updated_at: 1,
            device_id: 1,
            planogram_items_count: 1,
            detected_items_count: 1,
            shelves_wrongly_detected: 1,
            "oos_results.session_start_time": 1,
        })
            .sort({
                "oos_results.session_start_time": -1,
            })
            .limit(5);
        return doc;
    } catch (err) {
        console.log("-------error while find review --------", err);
        return [];
    }
};

const getReviewsBySessions = async (session_ids) => {
    let conditions = [
        {
            $match: {
                session_id: { $in: session_ids },
            },
        },
        {
            $project: {
                session_id: "$session_id",
                planogram_items_count: "$planogram_items_count",
                detected_items_count: "$detected_items_count",
                shelves_wrongly_detected: "$shelves_wrongly_detected",
                oos_reviews: "$oos_reviews",
                slot_reviews: "$slot_reviews",
                accuracy: "$accuracy",
                instock_accuracy: "$instock_accuracy",
                oos_accuracy: "$oos_accuracy",
            },
        },
    ];

    let doc = await Review.aggregate(conditions);
    return doc || [];
};

const getRecentReviewsByDeviceId = async (device_id) => {
    let doc = await Review.find(
        { device_id },
        {
            session_id: 1,
            planogram_items_count: 1,
            detected_items_count: 1,
            shelves_wrongly_detected: 1,
            updated_at: 1,
            accuracy: 1,
        }
    )
        .sort({ updated_at: -1 })
        .limit(50);
    return doc || [];
};

// created new method since previous method is using for getting review for all time
const getRecentReviewsByDeviceIdAndDateRange = async (device_id, query) => {
    let doc = await Review.find(
        {
            device_id,
            updated_at: {
                $gte: moment(query.start_date).format("YYYY-MM-DD"),
                $lte: moment(query.end_date).add(1, "days").format("YYYY-MM-DD"),
            },
        },
        {
            session_id: 1,
            device_id: 1,
            planogram_items_count: 1,
            detected_items_count: 1,
            shelves_wrongly_detected: 1,
            updated_at: 1,
            accuracy: 1,
            oos_accuracy: 1,
            instock_accuracy: 1,
            oos_items_count: 1,
            instock_items_count: 1,
        }
    ).sort({ updated_at: -1 });
    return doc || [];
};

const getDeviceSessionCount = async (device_id, query) => {
    try {
        const docs = await Session.find({
            device_id,
            updated_at: {
                $gte: moment(query.start_date).format("YYYY-MM-DD"),
                $lte: moment(query.end_date).format("YYYY-MM-DD"),
            },
        })
            .sort({
                "oos_results.session_start_time": -1,
            })
            .countDocuments();
        return docs;
    } catch (err) {
        console.log("-------error while find session --------", err);
        return 0;
    }
};

const generateSkuAccuracyReportCsv = async (req, res) => {
    try {
        const { category } = req.query;
        const matchQuery = {};

        if (category) {
            matchQuery["planogram.category"] = category;
        }

        const devices = await deviceService.getDevices(matchQuery, {
            device_id: 1,
            "planogram.category": 1,
        });

        const deviceIds = [];
        for (let i = 0; i < devices.length; i++) {
            deviceIds.push(devices[i].device_id);
        }

        let query = {
            device_id: { $in: deviceIds },
        };

        const { start_date, end_date } = req.query;

        let today = moment(start_date).startOf("day");
        let dayBeforeDuration = moment(end_date).subtract(6, "days");

        query["oos_results.session_start_time"] = {
            $gte: moment(dayBeforeDuration).format("YYYY-MM-DD"),
        };

        if ((start_date && !end_date) || (!start_date && end_date)) {
            return res.stasus(400).send({
                error: true,
                message: "Start and end date both required.",
            });
        } else if (start_date && end_date) {
            query["oos_results.session_start_time"] = {
                $gte: moment(start_date).format("YYYY-MM-DD"),
                $lte: moment(end_date).format("YYYY-MM-DD"),
            };
        }

        const reviews = await getSessionsForSummaryReport(query);
        reviewSummaryReport(req, res, reviews);
    } catch (e) {
        console.log("e----", e);
        return res.status(500).send({
            error: true,
            message: "Faild to generate report.",
        });
    }
};

const updateAllReviewAccuracy = async (req, res) => {
    try {
        const date = new Date();
        date.setMonth(date.getMonth() - 5);

        let reviews = await Review.find({
            accuracy: { $exists: false },
            created_at: { $gte: date },
        }).limit(100);
        console.log("Reviews to update :: ", reviews.length);
        req.setTimeout(50 * 10000 * 1500);
        let hasReviewToUpdate = true;

        do {
            for (let rIdx = 0; rIdx < reviews.length; rIdx++) {
                const shelves = await reduceShelves(reviews[rIdx]);
                let results;
                if (shelves) {
                    results = await calcAccuracy(shelves);
                }
                await Review.update(
                    { _id: reviews[rIdx]._id },
                    { $set: { accuracy: results || {} } }
                );
            }

            reviews = await Review.find({
                accuracy: { $exists: false },
                created_at: { $gte: date },
            }).limit(100);
            console.log("Reviews to update :: ", reviews.length);
            hasReviewToUpdate = reviews.length;
        } while (hasReviewToUpdate);

        return res.send({
            error: false,
            message: "Successfully updates.",
        });
    } catch (e) {
        console.log("----------e----", e);
        return res.status(400).send({
            error: true,
            message: "Faild to generate report.",
        });
    }
};

const updateDeviceAllReviewAccuracy = async (req, res) => {
    try {
        const date = new Date();
        date.setMonth(date.getMonth() - 5);

        let reviews = await Review.find({
            accuracy: { $exists: false },
            created_at: { $gte: date },
        }).limit(100);
        console.log("Reviews to update :: ", reviews.length);
        req.setTimeout(50 * 10000 * 1500);
        let hasReviewToUpdate = true;

        do {
            for (let rIdx = 0; rIdx < reviews.length; rIdx++) {
                const shelves = await reduceShelves(reviews[rIdx]);
                let results;
                if (shelves) {
                    results = await calcAccuracy(shelves);
                }
                await Review.update(
                    { _id: reviews[rIdx]._id },
                    { $set: { accuracy: results || {} } }
                );
            }

            reviews = await Review.find({
                accuracy: { $exists: false },
                created_at: { $gte: date },
            }).limit(100);
            console.log("Reviews to update :: ", reviews.length);
            hasReviewToUpdate = reviews.length;
        } while (hasReviewToUpdate);

        return res.send({
            error: false,
            message: "Successfully updates.",
        });
    } catch (e) {
        console.log("----------e----", e);
        return res.status(400).send({
            error: true,
            message: "Faild to generate report.",
        });
    }
};

const generateSkuAccuracyReportCsvV2 = async (req, res) => {
    try {
        const { category } = req.query;
        const matchQuery = {};

        if (category) {
            matchQuery["planogram.category"] = category;
        }

        const devices = await deviceService.getDevices(matchQuery, {
            device_id: 1,
            "planogram.category": 1,
        });

        req.setTimeout(5 * devices.length * 1000);
        reviewSummaryReportV2(req, res, devices, category);
    } catch (e) {
        return res.status(500).send({
            error: true,
            message: "Failed to generate report.",
        });
    }
};

const generateAvgSkuAccuracyReport = async (req, res) => {
    try {
        const { retailer } = req.query;
        const matchQuery = {};

        if (!retailer) {
            return res.status(400).send({
                error: true,
                message: "Retailer required.",
            });
        }

        const devicePrefix =
            (Constants.RETAILER_OPTIONS[retailer] &&
                `${Constants.RETAILER_OPTIONS[retailer]}-`) ||
            retailer;

        let devices = [];
        const { query } = req;
        if (query.limit || query.page) {
            devices = await deviceService.getDevicesWithPagination(
                { device_id: new RegExp(devicePrefix, "i") },
                {
                    device_id: 1,
                    "planogram.category": 1,
                },
                +query.limit || 100,
                +query.page || 1
            );
        } else {
            devices = await deviceService.getDevices(
                { device_id: new RegExp(devicePrefix, "i") },
                {
                    device_id: 1,
                    "planogram.category": 1,
                }
            );
        }
        // Not sure is this required or not
        // req.setTimeout(10 * devices.length * 1000)
        if (query.type === "json") {
            const summaryArray = await calculateAvgSkuAccuracy(
                res,
                devices,
                req.query
            );
            return res.send({
                error: false,
                data: summaryArray,
            });
        } else {
            const summaryArray = await calculateAvgSkuAccuracy(
                res,
                devices,
                req.query
            );
            const fields = [
                "Cooler",
                "Category",
                "Total Number of Sessions Captured",
                "No. of Sessions Reviewed",
                "Avg Slot Level Accuracy",
                "Avg SKU Level Accuracy",
                "OOS Accuracy",
                "Instock Accuracy",
            ];
            const json2csvParser = new Parser({ fields });
            const csv = json2csvParser.parse(summaryArray);
            res.set("Content-Type", "application/octet-stream");
            res.attachment(`sku-level-review-summary-report${query.retailer}.csv`);
            return res.send(csv);
        }
    } catch (e) {
        return res.status(500).send({
            error: true,
            message: "Failed to generate report.",
        });
    }
};

const calculateAvgSkuAccuracy = async (res, devices, query) => {
    try {
        const summaryArray = await Promise.all(
            devices.map(async (device) => {
                let reviewsForReport = [];
                const reviews = await getRecentReviewsByDeviceIdAndDateRange(
                    device.device_id,
                    query
                );
                const sessionsCount = await getDeviceSessionCount(
                    device.device_id,
                    query
                );

                for (let rIdx = 0; rIdx < reviews.length; rIdx++) {
                    const review = await prepareReviewForCsv(reviews[rIdx]);
                    if (review) {
                        reviewsForReport.push(review);
                    }
                }

                let totalAccuracy = await calculateSlotTotalAccuracy(reviewsForReport);

                let skuLevelAccuracy = await calculateSkuTotalAccuracy(
                    reviewsForReport
                );

                let oosAccuracy = await calculateOOSAndInstockAccuracy(
                    reviewsForReport,
                    "OOS Accuracy"
                );
                let instockAccuracy = await calculateOOSAndInstockAccuracy(
                    reviewsForReport,
                    "Instock Accuracy"
                );

                let object = {
                    "Total Number of Sessions Captured": sessionsCount || 0,
                    "No. of Sessions Reviewed": reviews.length || 0,
                    Cooler: device.device_id,
                    Category: (device.planogram && device.planogram.category) || "NA",
                    "Avg Slot Level Accuracy": totalAccuracy || "0%",
                    "Avg SKU Level Accuracy": skuLevelAccuracy || "0%",
                    "OOS Accuracy": oosAccuracy || "0",
                    "Instock Accuracy": instockAccuracy || "0",
                };
                return object;
            })
        );
        return summaryArray;
    } catch (e) {
        return res.status(400).send({
            error: true,
            message: "Failed to fetch the accuracy.",
        });
    }
};

const prepareReviewForCsv = async (reviewDoc) => {
    const { accuracy } = reviewDoc || {};
    if (!accuracy || (await Object.keys(accuracy).length) === 0) {
        return null;
    }
    const { sku_level_accuracy, slot_level_accuracy } = accuracy;

    if (!sku_level_accuracy || !slot_level_accuracy) {
        return null;
    }

    let skuTotalFalseNegativePercent;
    let skuTotalFalsePositivePercent;
    let total_items = 1; // to avoid the Infinity

    if (sku_level_accuracy && (await Object.keys(sku_level_accuracy).length)) {
        total_items = sku_level_accuracy.count || 1; // to avoid the Infinity
        if (sku_level_accuracy.false_negatives_percentage) {
            skuTotalFalseNegativePercent =
                sku_level_accuracy.false_negatives_percentage;
        } else {
            const skuTotalFalseNegative =
                sku_level_accuracy.false_negatives / sku_level_accuracy.count;
            skuTotalFalseNegativePercent = (skuTotalFalseNegative * 100).toFixed(2);
        }

        if (sku_level_accuracy.false_positives_percentage) {
            skuTotalFalsePositivePercent =
                sku_level_accuracy.false_positives_percentage;
        } else {
            const skuTotalFalsePositive =
                sku_level_accuracy.false_positives / sku_level_accuracy.count;
            skuTotalFalsePositivePercent = (skuTotalFalsePositive * 100).toFixed(2);
        }
    }

    const skuLevel = {
        falseNegativePercent: skuTotalFalseNegativePercent,
        falsePositivePercent: skuTotalFalsePositivePercent,
        accuracy: (sku_level_accuracy && sku_level_accuracy.accuracy) || 0,
    };

    let totalFalseNegativePercent;
    let totalFalsePositivePercent;

    if (slot_level_accuracy && (await Object.keys(slot_level_accuracy).length)) {
        if (slot_level_accuracy.false_negatives_percentage) {
            totalFalseNegativePercent =
                slot_level_accuracy.false_negatives_percentage;
        } else {
            const totalFalseNegative =
                slot_level_accuracy.false_negatives / slot_level_accuracy.count;
            totalFalseNegativePercent = (totalFalseNegative * 100).toFixed(2);
        }

        if (slot_level_accuracy.false_positives_percentage) {
            totalFalsePositivePercent =
                slot_level_accuracy.false_positives_percentage;
        } else {
            const totalFalsePositive =
                slot_level_accuracy.false_positives / slot_level_accuracy.count;
            totalFalsePositivePercent = (totalFalsePositive * 100).toFixed(2);
        }
    }

    const slotLevel = {
        falseNegativePercent: totalFalseNegativePercent,
        falsePositivePercent: totalFalsePositivePercent,
        accuracy: (slot_level_accuracy && slot_level_accuracy.accuracy) || 0,
    };

    let returnObj = {
        Category: reviewDoc.category,
        Session: reviewDoc.session_id,
        Cooler: reviewDoc.device_id,
        Date: new Date(reviewDoc.created_at),
        "Total Items (Planogram)": reviewDoc.planogram_items_count,
        "Correct OOS (Detected)": reviewDoc.detected_items_count,
        // slot level
        "False Negative % (Slot Level)": `${slotLevel.falseNegativePercent || 0} %`,
        "False Positive % (Slot Level)": `${slotLevel.falsePositivePercent || 0} %`,
        "Accuracy (Slot Level)": `${slotLevel.accuracy} %`,
        // sku level
        "False Negative % (SKU Level)": `${skuLevel.falseNegativePercent || 0} %`,
        "False Positive % (SKU Level)": `${skuLevel.falsePositivePercent || 0} %`,
        "Accuracy (SKU Level)": `${skuLevel.accuracy} %`,
        "OOS Accuracy": reviewDoc.oos_accuracy,
        "Instock Accuracy": reviewDoc.instock_accuracy,
    };

    return returnObj;
};

const calculateSlotTotalAccuracy = (reviewsData) => {
    let accuracy = 0;
    for (let review of reviewsData) {
        let accuracyVal = review["Accuracy (Slot Level)"] || "";
        accuracyVal = (accuracyVal && accuracyVal.replace(" %", "")) || 0;
        accuracy += parseFloat(accuracyVal);
    }
    let totalAccuracy = parseFloat(accuracy / reviewsData.length) || 0;
    return `${totalAccuracy ? totalAccuracy.toFixed(2) : 0}`;
};

const calculateSkuTotalAccuracy = (reviewsData) => {
    let accuracy = 0;
    for (let review of reviewsData) {
        let accuracyVal = review["Accuracy (SKU Level)"] || "";
        accuracyVal = (accuracyVal && accuracyVal.replace(" %", "")) || 0;
        accuracy += parseFloat(accuracyVal);
    }
    let totalAccuracy = parseFloat(accuracy / reviewsData.length) || 0;
    return `${totalAccuracy ? totalAccuracy.toFixed(2) : 0}`;
};

const calcInstockAndOOSAccuracy = (
    review,
    is_response = true,
    is_report = false
) => {
    try {
        const shelves = review["accuracy"]["shelves"];
        let products = {};
        let accuracy = {};
        let shelf_based_classification = {};
        let i = 0;
        shelves.map((shelf) => {
            products = {};
            i += 1;
            shelf["slots"].map((slot) => {
                if (
                    !(
                        Object.keys(products).length > 0 &&
                        Object.keys(products).includes(slot["upc"])
                    )
                ) {
                    products[slot["upc"]] = {};
                    products[slot["upc"]]["correct_oos"] = slot["correct_oos"];
                    products[slot["upc"]]["detected_oos"] = slot["detected_oos"];
                } else {
                    products[slot["upc"]]["correct_oos"] =
                        products[slot["upc"]]["correct_oos"] && slot["correct_oos"];
                    products[slot["upc"]]["detected_oos"] =
                        products[slot["upc"]]["detected_oos"] && slot["detected_oos"];
                }
            });
            console.log();
            shelf_based_classification["Shelf No. " + i] = products;
            let correct_instock = 0;
            let correct_oos = 0;
            let detected_instock = 0;
            let detected_oos = 0;

            Object.keys(products).map((product_key) => {
                let product = products[product_key];
                if (product["correct_oos"] === true) {
                    correct_oos += 1;
                    if (product["detected_oos"] === true) {
                        detected_oos += 1;
                    }
                } else {
                    correct_instock += 1;
                    if (product["detected_oos"] === false) {
                        detected_instock += 1;
                    }
                }

                let instock_acc;
                let oos_acc;

                if (correct_instock === 0) {
                    instock_acc = 100;
                } else {
                    instock_acc = ((detected_instock / correct_instock) * 100).toFixed(2);
                }

                if (correct_oos === 0) {
                    oos_acc = 100;
                } else {
                    oos_acc = ((detected_oos / correct_oos) * 100).toFixed(2);
                }
                accuracy[i] = {
                    instock_acc: `${instock_acc}% (${detected_instock}/${correct_instock})`,
                    oos_acc: `${oos_acc}% (${detected_oos}/${correct_oos})`,
                };
            });
        });

        // calculating the overall accuracy
        let correct_instock = 0;
        let correct_oos = 0;
        let detected_instock = 0;
        let detected_oos = 0;

        Object.keys(shelf_based_classification).map((shelf_key) => {
            let products = shelf_based_classification[shelf_key];
            Object.keys(products).map((product_key) => {
                let product = products[product_key];
                if (product["correct_oos"] === true) {
                    correct_oos += 1;
                    if (product["detected_oos"] === true) {
                        detected_oos += 1;
                    }
                } else {
                    correct_instock += 1;
                    if (product["detected_oos"] === false) {
                        detected_instock += 1;
                    }
                }
            });
        });

        let instock_acc;
        let oos_acc;

        if (correct_instock === 0) {
            instock_acc = 100;
        } else {
            instock_acc = ((detected_instock / correct_instock) * 100).toFixed(2);
        }

        if (correct_oos === 0) {
            oos_acc = 100;
        } else {
            oos_acc = ((detected_oos / correct_oos) * 100).toFixed(2);
        }

        accuracy["Total"] = {
            instock_acc: `${instock_acc}% (${detected_instock}/${correct_instock})`,
            oos_acc: `${oos_acc}% (${detected_oos}/${correct_oos})`,
        };

        if (is_report) {
            accuracy = {
                totalInstock: correct_instock,
                detectedInstock: detected_instock,
                totalOos: correct_oos,
                detectedOos: detected_oos,
            };
            accuracy["Total"] = {
                instock_acc: `${instock_acc}% (${detected_instock}/${correct_instock})`,
                oos_acc: `${oos_acc}% (${detected_oos}/${correct_oos})`,
            };
            return accuracy;
        } else {
            if (is_response) {
                return {
                    instock_acc: instock_acc,
                    oos_acc: oos_acc,
                    correct_oos: correct_oos,
                };
            } else {
                return accuracy;
            }
        }
    } catch (error) {
        console.log("Error", error);
    }
};

const calcInstockAndOOSAccuracyCombinedAndShelfBased = async (
    review,
    purpose = "default_review"
) => {
    try {
        //   let review  = await Review.findOne(
        //     {
        //       device_id: deviceId,
        //       session_id: sessionId
        //     })

        const shelves = review["accuracy"]["shelves"];
        let shelf_based_classification = {};
        let accuracy = {};

        // shelf based classification and calulating the shelf accuracy and storing it in the accuracy object
        for (let i = 0; i < shelves.length; i++) {
            let products = {};
            shelves[i]["slots"].map((slot, index) => {
                products[slot["upc"] + index] = {};
                products[slot["upc"] + index]["correct_oos"] = slot["correct_oos"];
                products[slot["upc"] + index]["detected_oos"] = slot["detected_oos"];
            });
            // combining the shelf based accuracy named as products in shel_based_classification object
            shelf_based_classification["Shelf No. " + shelves[i]["shelf_number"]] =
                products;

            let correct_instock = 0;
            let correct_oos = 0;
            let detected_instock = 0;
            let detected_oos = 0;
            // calculatin shelf based accuracy
            let productss = products;
            Object.keys(productss).map((product_key) => {
                let product = productss[product_key];
                if (product["correct_oos"] === true) {
                    correct_oos += 1;
                    if (product["detected_oos"] === true) {
                        detected_oos += 1;
                    }
                } else {
                    correct_instock += 1;
                    if (product["detected_oos"] === false) {
                        detected_instock += 1;
                    }
                }
            });

            // console.log('correct_oos', correct_oos)
            // console.log('correct_instock', correct_instock)
            // console.log('detected_oos', detected_oos)
            // console.log('detected_instock', detected_instock)

            let instock_acc;
            let oos_acc;

            if (correct_instock === 0) {
                instock_acc = (100.0).toFixed(2);
            } else {
                instock_acc = ((detected_instock / correct_instock) * 100).toFixed(2);
            }

            if (correct_oos === 0) {
                oos_acc = (100.0).toFixed(2);
                // console.log(oos_acc)
            } else {
                oos_acc = ((detected_oos / correct_oos) * 100).toFixed(2);
            }
            // console.log("in acc " + instock_acc+" %")
            // console.log("on acc " + oos_acc+" %")
            accuracy[i + 1] = {
                instock_acc: `${instock_acc}% (${detected_instock}/${correct_instock})`,
                oos_acc: `${oos_acc}% (${detected_oos}/${correct_oos})`,
            };
        }
        // calculating the overall accuracy
        let correct_instock = 0;
        let correct_oos = 0;
        let detected_instock = 0;
        let detected_oos = 0;

        Object.keys(shelf_based_classification).map((shelf_key) => {
            let products = shelf_based_classification[shelf_key];
            Object.keys(products).map((product_key) => {
                let product = products[product_key];
                if (product["correct_oos"] === true) {
                    correct_oos += 1;
                    if (product["detected_oos"] === true) {
                        detected_oos += 1;
                    }
                } else {
                    correct_instock += 1;
                    if (product["detected_oos"] === false) {
                        detected_instock += 1;
                    }
                }
            });
        });

        let instock_acc;
        let oos_acc;

        if (correct_instock === 0) {
            instock_acc = 100;
        } else {
            instock_acc = ((detected_instock / correct_instock) * 100).toFixed(2);
        }

        if (correct_oos === 0) {
            oos_acc = 100;
        } else {
            oos_acc = ((detected_oos / correct_oos) * 100).toFixed(2);
        }

        accuracy["Total"] = {
            instock_acc: `${instock_acc}% (${detected_instock}/${correct_instock})`,
            oos_acc: `${oos_acc}% (${detected_oos}/${correct_oos})`,
        };

        // for accuracy summary report changing the oputput format.
        if (purpose == "report") {
            accuracy = {
                totalInstock: correct_instock,
                detectedInstock: detected_instock,
                totalOos: correct_oos,
                detectedOos: detected_oos,
            };
            accuracy["Total"] = {
                instock_acc: `${instock_acc}% (${detected_instock}/${correct_instock})`,
                oos_acc: `${oos_acc}% (${detected_oos}/${correct_oos})`,
            };
        }

        // console.log(accuracy)
        return accuracy;
    } catch (error) {
        console.log("Error", error);
    }
};

function calculateOOSAndInstockAccuracy(reviewsData, key) {
    let accuracy = 0;
    for (let review of reviewsData) {
        let accuracyVal = review[key] || "";
        accuracyVal = accuracyVal.replace(" %", "") || 0;
        accuracy += parseFloat(accuracyVal);
    }
    let totalAccuracy = parseFloat(accuracy / reviewsData.length) || 0;
    return `${totalAccuracy ? totalAccuracy.toFixed(2) : 0}`;
}

export default {
    getReview,
    createReview,
    updateReview,
    getReviewsForReport,
    getOOSReviews,
    getReviewsForSummaryReport,
    getReviewsForSummaryReportV2,
    getSessionsForSummaryReport,
    getReviewsBySessions,
    generateSkuAccuracyReportCsv,
    generateSkuAccuracyReportCsvV2,
    updateAllReviewAccuracy,
    generateAvgSkuAccuracyReport,
    getRecentFiveSessionsForSummaryReport,
    prepareReviewForCsv,
    calculateSlotTotalAccuracy,
    calculateSkuTotalAccuracy,
    updateDeviceAllReviewAccuracy,
    calcInstockAndOOSAccuracy,
    calcInstockAndOOSAccuracyCombinedAndShelfBased,
};

const prepareReviewDocForCsvV2 = async (reviewDoc) => {
    const { accuracy } = reviewDoc;

    if (
        !accuracy ||
        !accuracy.sku_level_accuracy ||
        Object.keys(accuracy).length === 0
    ) {
        return null;
    }
    const { sku_level_accuracy, slot_level_accuracy } = accuracy;
    let skuTotalFalseNegativePercent;
    let skuTotalFalsePositivePercent;

    const total_items = accuracy.sku_level_accuracy.count || 1; // to avoid the Infinity
    if (sku_level_accuracy && sku_level_accuracy.false_negatives_percentage) {
        skuTotalFalseNegativePercent =
            sku_level_accuracy.false_negatives_percentage;
    } else {
        const skuTotalFalseNegative =
            accuracy.sku_level_accuracy.false_negatives /
            accuracy.sku_level_accuracy.count;
        skuTotalFalseNegativePercent = (skuTotalFalseNegative * 100).toFixed(2);
    }

    if (sku_level_accuracy && sku_level_accuracy.false_positives_percentage) {
        skuTotalFalsePositivePercent =
            sku_level_accuracy.false_positives_percentage;
    } else {
        const skuTotalFalsePositive =
            accuracy.sku_level_accuracy.false_positives /
            accuracy.sku_level_accuracy.count;
        skuTotalFalsePositivePercent = (skuTotalFalsePositive * 100).toFixed(2);
    }

    const skuLevel = {
        falseNegativePercent: skuTotalFalseNegativePercent,
        falsePositivePercent: skuTotalFalsePositivePercent,
        accuracy: accuracy.sku_level_accuracy.accuracy,
    };

    let totalFalseNegativePercent;
    let totalFalsePositivePercent;

    if (slot_level_accuracy && slot_level_accuracy.false_negatives_percentage) {
        totalFalseNegativePercent = slot_level_accuracy.false_negatives_percentage;
    } else {
        const totalFalseNegative =
            accuracy.slot_level_accuracy.false_negatives /
            accuracy.slot_level_accuracy.count;
        totalFalseNegativePercent = (totalFalseNegative * 100).toFixed(2);
    }

    if (slot_level_accuracy && slot_level_accuracy.false_positives_percentage) {
        totalFalsePositivePercent = slot_level_accuracy.false_positives_percentage;
    } else {
        const totalFalsePositive =
            accuracy.slot_level_accuracy.false_positives /
            accuracy.slot_level_accuracy.count;
        totalFalsePositivePercent = (totalFalsePositive * 100).toFixed(2);
    }

    const slotLevel = {
        falseNegativePercent: totalFalseNegativePercent,
        falsePositivePercent: totalFalsePositivePercent,
        accuracy: accuracy.slot_level_accuracy.accuracy,
    };

    let returnObj = {
        Cooler: reviewDoc.device_id,
        Date: new Date(reviewDoc.created_at),
        "Total Items (Planogram)": total_items,
        "OOS Accuracy: \n(100 - FP% - FN%)": `${slotLevel.accuracy} %`,
        "SKU Level Accuracy": `${skuLevel.accuracy} %`,
    };

    return returnObj;
};

const prepareReviewDocForCsv = async (reviewDoc) => {
    let detectionCounts = await getDetectionCounts(reviewDoc);
    const total_items = reviewDoc.planogram_items_count || 1; // to avoid the Infinity
    const falsePositive =
        detectionCounts.total_over_detection_count / total_items;
    const falseNegative =
        detectionCounts.total_missed_detection_count / total_items;

    const skuFalsePositive =
        detectionCounts.total_sku_level_over_detection_count / total_items;
    const skuFalseNegative =
        detectionCounts.total_sku_level_missed_detection_count / total_items;

    const falseNegativePercent = (falseNegative * 100).toFixed(2);
    const falsePositivePercent = (falsePositive * 100).toFixed(2);
    const skuFalseNegativePercent = (skuFalseNegative * 100).toFixed(2);
    const skuFalsePositivePercent = (skuFalsePositive * 100).toFixed(2);
    const skuAccuracy =
        100 - (skuFalseNegativePercent || 0) - (skuFalsePositivePercent || 0);

    const accuracy =
        100 - (falseNegativePercent || 0) - (falsePositivePercent || 0);

    let returnObj = {
        Session: reviewDoc.session_id,
        Cooler: reviewDoc.device_id,
        Date: new Date(reviewDoc.created_at),
        "Total Items (Planogram)": reviewDoc.planogram_items_count,
        "Correct OOS (Detected)": reviewDoc.detected_items_count,
        "False Positives (Over detection)":
            detectionCounts.total_over_detection_count,
        "False Negatives (Missed Detection)":
            detectionCounts.total_missed_detection_count,
        "False Negative %": `${falseNegativePercent || 0} %`,
        "False Positive %": `${falsePositivePercent || 0} %`,
        "OOS Accuracy: \n(100 - FP% - FN%)": `${accuracy} %`,
        "SKU Level Accuracy": `${skuAccuracy} %`,
    };

    return returnObj;
};

function getDetectionCounts(review) {
    const { oos_reviews, slot_reviews } = review;

    if (!oos_reviews) {
        return {};
    }

    const detection_counts = {
        total_over_detection_count: 0,
        total_sku_level_over_detection_count: 0,
        total_missed_detection_count: 0,
        total_sku_level_missed_detection_count: 0,
    };

    const shelfs = Object.keys(oos_reviews);
    if (shelfs) {
        for (let idx = 0; idx < shelfs.length; idx++) {
            detection_counts.total_over_detection_count +=
                Number(oos_reviews[shelfs[idx]].over_detection_count) || 0;

            detection_counts.total_missed_detection_count +=
                Number(oos_reviews[shelfs[idx]].missed_detection_count) || 0;
        }
    }

    detection_counts.total_sku_level_over_detection_count = 0;
    detection_counts.total_sku_level_missed_detection_count = 0;

    const skuLevelShelfs = Object.keys(oos_reviews);
    if (skuLevelShelfs && skuLevelShelfs.length) {
        for (let idx = 0; idx < skuLevelShelfs.length; idx++) {
            try {
                const {
                    planogram: { slots },
                } = slot_reviews[idx];
                const products = [];
                for (let sIdx = 0; sIdx < slots.length; sIdx++) {
                    if (!products.length) {
                        products.push(slots[sIdx]);
                    } else {
                        for (let pIdx = 0; pIdx < products.length; pIdx++) {
                            if (slots[sIdx].product_name === products[pIdx].product_name) {
                                products[pIdx].oos = slots[sIdx].oos || products[pIdx].oos;
                                if (
                                    products[pIdx].hasOwnProperty("oos_update") ||
                                    slots[sIdx].hasOwnProperty("oos_update")
                                ) {
                                    products[pIdx].has_oos_update =
                                        products[pIdx].oos_update || products[pIdx].oos_update;
                                }
                            }
                        }
                    }
                }

                for (let pIdx = 0; pIdx < products.length; pIdx++) {
                    if (products[pIdx].oos && products[pIdx].oos_update === false) {
                        detection_counts.total_sku_level_missed_detection_count += 1;
                    } else if (
                        products[pIdx].oos === false &&
                        products[pIdx].oos_update
                    ) {
                        detection_counts.total_sku_level_over_detection_count += 1;
                    }
                }
            } catch (e) {
                // nothing to do.
            }
        }
    }

    return detection_counts;
}
const reviewSummaryReport = async (req, res, reviewsForReport) => {
    try {
        const {
            // resType, sendEmail,
            category,
        } = req.query;
        let summaryArray = [];
        const groupByDate = await groupBy(reviewsForReport, "Date");
        const keys = Object.keys(groupByDate);
        async.forEach(
            keys,
            async (key, outerCallback) => {
                const groupKey = key.split(";");
                let cooler = groupKey[1];
                const reviewsData = groupByDate[key] || [];
                const sessions = reviewsData || [];
                let session_ids = [];
                const device = await deviceService.getDevice(cooler);
                const categoryName =
                    (device && device.planogram && device.planogram.category) || "";
                if (!category || categoryName === category) {
                    async.forEach(
                        sessions,
                        (session, callback) => {
                            session_ids.push(session.session_id);
                            callback();
                        },
                        async (err) => {
                            const reviewsForReport = [];
                            const reviews = await getReviewsBySessions(session_ids);
                            for (let rIdx = 0; rIdx < reviews.length; rIdx++) {
                                const review = await prepareReviewDocForCsv(
                                    reviews[rIdx],
                                    "summary"
                                );
                                if (review) {
                                    reviewsForReport.push(review);
                                }
                            }
                            let totalAccuracy = await calculateTotalAccuracy(
                                reviewsForReport
                            );
                            let skuLevelAccuracy = await calculateSkuLevelAccuracy(
                                reviewsForReport
                            );

                            let sessionReviewCount = await getCapturedReviewCount(reviews);

                            let object = {
                                "Number Of Sessions Reviewed": sessionReviewCount,
                                Cooler: cooler,
                                Accuracy: totalAccuracy,
                                "SKU Level Accuracy": skuLevelAccuracy,
                            };
                            summaryArray.push(object);
                            outerCallback();
                        }
                    );
                } else {
                    outerCallback();
                }
            },
            (err) => {
                const fields = [
                    "Cooler",
                    "Number Of Sessions Reviewed",
                    "Accuracy",
                    "SKU Level Accuracy",
                ];
                const json2csvParser = new Parser({ fields });
                const csv = json2csvParser.parse(summaryArray);
                res.set("Content-Type", "application/octet-stream");
                res.attachment("sku-level-review-summary-report.csv");
                return res.send(csv);
            }
        );
    } catch (error) {
        console.log("error", error);
        res.status(200).json({ error: true, message: error.message });
    }
};

const reviewSummaryReportV2 = async (req, res, devices, categoryName = "") => {
    try {
        let summaryArray = [];

        async.forEach(
            devices,
            async (device, outerCallback) => {
                let reviewsForReport = [];

                const reviews = await getRecentReviewsByDeviceId(device.device_id);

                for (let rIdx = 0; rIdx < reviews.length; rIdx++) {
                    const review = await prepareReviewDocForCsvV2(reviews[rIdx]);
                    if (review) {
                        reviewsForReport.push(review);
                    }
                }

                let totalAccuracy = await calculateTotalAccuracy(reviewsForReport);

                let skuLevelAccuracy = await calculateSkuLevelAccuracy(
                    reviewsForReport
                );

                let sessionReviewCount = await getCapturedReviewCount(reviews);

                let object = {
                    "Number Of Sessions Reviewed": reviews.length || 0,
                    Cooler: device.device_id,
                    Category: (device.planogram && device.planogram.category) || "NA",
                    Accuracy: totalAccuracy,
                    "SKU Level Accuracy": skuLevelAccuracy,
                };
                summaryArray.push(object);
                outerCallback();
            },
            (err) => {
                const fields = [
                    "Cooler",
                    "Category",
                    "Number Of Sessions Reviewed",
                    "Accuracy",
                    "SKU Level Accuracy",
                ];

                const json2csvParser = new Parser({ fields });
                const csv = json2csvParser.parse(summaryArray);
                res.set("Content-Type", "application/octet-stream");
                res.attachment(
                    `sku-level-review-summary-report${categoryName ? "-" + categoryName.replace("/", "-") : ""
                    }.csv`
                );
                // return res.send({ summaryArray: summaryArray })
                return res.send(csv);
            }
        );
    } catch (error) {
        console.log("error", error);
        res.status(200).json({ error: true, message: error.message });
    }
};

const getCapturedReviewCount = async (reviews) => {
    const reviewsCount = await reviews.reduce((count, item) => {
        if (item.accuracy) {
            count += 1;
        }
        return count;
    }, 0);
    return reviewsCount;
};

function calculateSkuLevelAccuracy(reviewsData, resType) {
    let accuracy = 0;
    for (let review of reviewsData) {
        let accuracyVal = review["SKU Level Accuracy"] || "";
        accuracyVal = (accuracyVal && accuracyVal.replace(" %", "")) || 0;
        accuracy += parseFloat(accuracyVal);
    }
    let totalAccuracy = parseFloat(accuracy / reviewsData.length) || 0;
    totalAccuracy = totalAccuracy === 0 ? "" : totalAccuracy.toFixed(2);
    return `${totalAccuracy}${totalAccuracy ? " %" : ""}`;
}

function calculateTotalAccuracy(reviewsData) {
    let accuracy = 0;
    for (let review of reviewsData) {
        let accuracyVal = review["OOS Accuracy: \n(100 - FP% - FN%)"] || "";
        accuracyVal = (accuracyVal && accuracyVal.replace(" %", "")) || 0;
        accuracy += parseFloat(accuracyVal);
    }
    let totalAccuracy = parseFloat(accuracy / reviewsData.length || 0);
    totalAccuracy = totalAccuracy === 0 ? "" : totalAccuracy.toFixed(2);
    return `${totalAccuracy}${totalAccuracy ? " %" : ""}`;
}

const reduceShelves = (review) => {
    const { slot_reviews } = review;
    let shelves = [];
    // console.log(slot_reviews);
    if (!slot_reviews || slot_reviews == []) {
        // console.log("inside")
        return [];
    }

    for (let shelf_idx = 0; shelf_idx < slot_reviews.length; shelf_idx++) {
        shelves.push({
            shelf_number: shelf_idx + 1,
            slots: [],
        });
        const slots =
            (slot_reviews[shelf_idx] &&
                slot_reviews[shelf_idx]["planogram"] &&
                slot_reviews[shelf_idx]["planogram"]["slots"]) ||
            [];

        for (let slot of slots) {
            let detected_oos = slot["oos"];
            let correct_oos;
            if (!slot.hasOwnProperty("oos_update")) {
                correct_oos = detected_oos;
            } else if (slot["oos_update"] == slot["oos"]) {
                correct_oos = detected_oos;
            } else {
                correct_oos = !detected_oos;
            }

            shelves[shelf_idx]["slots"].push({
                slot_number: slot["slot_number"],
                upc: slot["upc"],
                product_name: slot["product_name"],
                detected_oos: detected_oos,
                correct_oos: correct_oos,
            });
        }
    }

    return shelves;
};

const calcAccuracy = async (shelves, deviceId) => {
    let device = await Device.findOne(
        {
            device_id: deviceId,
        },
        {
            oos_disabled_shelves: 1,
            _id: 0,
        }
    );
    if (!shelves || shelves.length === 0) {
        return;
    }

    // # Calculate Slot and SKU level accuracy for individual shelves
    for (let shelf of shelves) {
        // let oos_disabled_shelves = (!device.oos_disabled_shelves ||
        //   (device.oos_disabled_shelves &&
        //     device.oos_disabled_shelves[`shelf${shelf.shelf_number}`])) ?
        //     true : false
        let oos_disabled_shelves =
            Object.keys(device.oos_disabled_shelves).length > 0
                ? device.oos_disabled_shelves[`shelf${shelf.shelf_number}`]
                    ? device.oos_disabled_shelves[`shelf${shelf.shelf_number}`]
                    : false
                : true;

        shelf["slot_level_accuracy"] = await _calc_slot_level_accuracy(
            shelf["slots"],
            oos_disabled_shelves
        );
        shelf["sku_level_accuracy"] = await _calc_sku_level_accuracy(
            shelf["slots"],
            oos_disabled_shelves
        );
    }

    // # Calculate Slot and SKU level accuracy for overall cooler.
    const slots = [];
    for (let shelf of shelves) {
        let oos_disabled_shelves =
            Object.keys(device.oos_disabled_shelves).length > 0
                ? device.oos_disabled_shelves[`shelf${shelf.shelf_number}`]
                    ? device.oos_disabled_shelves[`shelf${shelf.shelf_number}`]
                    : false
                : true;

        if (oos_disabled_shelves) {
            for (let slot of shelf["slots"]) {
                slots.push(slot);
            }
        }
    }

    const results = {
        slot_level_accuracy: await _calc_slot_level_accuracy(slots),
        sku_level_accuracy: await _calc_sku_level_accuracy(slots),
        shelves: shelves,
    };

    return results;
};

const _calc_slot_level_accuracy = (slots, oos_disabled_shelves = true) => {
    if (!oos_disabled_shelves) {
        return {
            count: slots.length,
            false_positives: null,
            false_positives_percentage: null,
            false_negatives_percentage: null,
            false_negatives: null,
            accuracy: null,
        };
    }
    if (!slots || slots.length == 0) {
        return null;
    }
    let slots_count = slots.length;
    let false_positives = 0;
    let false_negatives = 0;

    for (let slot of slots) {
        if (slot["detected_oos"] === false && slot["correct_oos"] === true) {
            // # Item is detected as in-stock, but actually out-of-stock
            false_negatives += 1;
        } else if (slot["detected_oos"] === true && slot["correct_oos"] === false) {
            // # Item is detected as out-of-stock, but actually in-stock.
            false_positives += 1;
        }
    }

    const false_positives_percentage = _calc_false_percentage(
        slots_count,
        false_positives
    );
    const false_negatives_percentage = _calc_false_percentage(
        slots_count,
        false_negatives
    );
    return {
        count: slots_count,
        false_positives: false_positives,
        false_positives_percentage: false_positives_percentage,
        false_negatives_percentage: false_negatives_percentage,
        false_negatives: false_negatives,
        accuracy: +parseFloat(
            (100 * (slots_count - false_positives - false_negatives)) / slots_count
        ).toFixed(2),
    };
};

// calculation false percentage
const _calc_false_percentage = (slots_count, false_value) => {
    const avarage_value = false_value / slots_count;
    const percentage = (avarage_value * 100).toFixed(2);
    return percentage;
};

const _calc_sku_level_accuracy = async (slots, oos_disabled_shelves = true) => {
    if (!oos_disabled_shelves) {
        return {
            count: slots.length,
            false_positives: null,
            false_positives_percentage: null,
            false_negatives_percentage: null,
            false_negatives: null,
            accuracy: null,
        };
    }

    if (!slots || slots.length == 0) {
        return null;
    }
    const products = [];
    const products_set = {};
    // # Create a products array for these slots
    for (let slot of slots) {
        if (!products_set[slot["upc"]]) {
            products_set[slot["upc"]] = slot["upc"];
            let detected_oos = true;
            let correct_oos = true;
            for (let slot2 of slots) {
                if (slot2["upc"] === slot["upc"]) {
                    detected_oos = detected_oos && slot2["detected_oos"];
                    correct_oos = correct_oos && slot2["correct_oos"];
                }
            }
            products.push({
                product_name: slot["product_name"],
                upc: slot["upc"],
                detected_oos: detected_oos,
                correct_oos: correct_oos,
            });
        }
    }
    return await _calc_slot_level_accuracy(products, oos_disabled_shelves);
};
